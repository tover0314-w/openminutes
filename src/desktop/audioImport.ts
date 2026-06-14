import { getTauriInvoke, isTauriRuntime, type TauriInvoke } from './tauri'

const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'mp4', 'wav', 'webm', 'ogg', 'flac']

export interface ImportedAudioPayload {
  fileName: string
  mimeType: string
  bytes: number[]
}

export type OpenAudioDialog = (options: {
  filters: Array<{ name: string; extensions: string[] }>
  multiple: false
}) => Promise<string | string[] | null>

export class TauriAudioImportPicker {
  constructor(
    private readonly invoke: TauriInvoke,
    private readonly openDialog: OpenAudioDialog,
  ) {}

  async select(): Promise<File | undefined> {
    const selected = await this.openDialog({
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
      multiple: false,
    })
    const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return undefined

    const payload = await this.invoke<ImportedAudioPayload>('read_audio_import_file', { path })
    return new File([Uint8Array.from(payload.bytes)], payload.fileName, {
      type: payload.mimeType,
    })
  }
}

export async function selectTauriAudioFile(): Promise<File | undefined> {
  if (!isTauriRuntime()) return undefined

  const [invoke, dialog] = await Promise.all([
    getTauriInvoke(),
    import('@tauri-apps/plugin-dialog'),
  ])
  if (!invoke) return undefined

  return new TauriAudioImportPicker(invoke, dialog.open as OpenAudioDialog).select()
}

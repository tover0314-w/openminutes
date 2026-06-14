import { describe, expect, it, vi } from 'vitest'
import { TauriAudioImportPicker } from './audioImport'
import { type TauriInvoke } from './tauri'

describe('TauriAudioImportPicker', () => {
  it('opens a native audio picker and reads the selected file through Tauri', async () => {
    const openDialog = vi.fn(async () => '/tmp/customer-call.wav')
    const invoke = vi.fn(async () => ({
      fileName: 'customer-call.wav',
      mimeType: 'audio/wav',
      bytes: [1, 2, 3],
    })) as TauriInvoke
    const picker = new TauriAudioImportPicker(invoke, openDialog)

    const file = await picker.select()

    expect(openDialog).toHaveBeenCalledWith({
      filters: [{ name: 'Audio', extensions: ['m4a', 'mp3', 'mp4', 'wav', 'webm', 'ogg', 'flac'] }],
      multiple: false,
    })
    expect(invoke).toHaveBeenCalledWith('read_audio_import_file', {
      path: '/tmp/customer-call.wav',
    })
    expect(file?.name).toBe('customer-call.wav')
    expect(file?.type).toBe('audio/wav')
    expect(file?.size).toBe(3)
  })

  it('returns undefined when the picker is cancelled', async () => {
    const openDialog = vi.fn(async () => null)
    const invoke = vi.fn() as TauriInvoke
    const picker = new TauriAudioImportPicker(invoke, openDialog)

    await expect(picker.select()).resolves.toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })
})

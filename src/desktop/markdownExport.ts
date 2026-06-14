import { getTauriInvoke, type TauriInvoke } from './tauri'

export interface MarkdownExportResult {
  path?: string
  mode: 'tauri-file' | 'browser-download' | 'unavailable'
}

export async function exportMarkdownFile(
  fileName: string,
  markdown: string,
): Promise<MarkdownExportResult> {
  const invoke = await getTauriInvoke()

  if (invoke) {
    return exportWithTauri(invoke, fileName, markdown)
  }

  return exportWithBrowser(fileName, markdown)
}

async function exportWithTauri(
  invoke: TauriInvoke,
  fileName: string,
  markdown: string,
): Promise<MarkdownExportResult> {
  const result = await invoke<{ path: string }>('export_meeting_markdown', {
    fileName,
    markdown,
  })

  return {
    path: result.path,
    mode: 'tauri-file',
  }
}

function exportWithBrowser(fileName: string, markdown: string): MarkdownExportResult {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return { mode: 'unavailable' }
  }

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeFileName(fileName)}.md`
  link.click()
  URL.revokeObjectURL(url)

  return { mode: 'browser-download' }
}

function safeFileName(fileName: string): string {
  const safe = fileName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)

  return safe || 'meeting-notes'
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportMarkdownFile } from './markdownExport'

describe('exportMarkdownFile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports unavailable when neither Tauri nor browser download APIs exist', async () => {
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('URL', undefined)

    await expect(exportMarkdownFile('Meeting', '# Notes')).resolves.toEqual({
      mode: 'unavailable',
    })
  })
})

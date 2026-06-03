import { toJpeg } from 'html-to-image'
import type { Entry } from './types'

function filename(entry: Entry): string {
  return `edabible-${entry.date}.jpg`
}

function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const [meta, data] = dataUrl.split(',')
  const binary = meta.includes(';base64') ? atob(data) : decodeURIComponent(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], name, { type })
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function createEntryImageFile(
  node: HTMLElement,
  entry: Entry,
): Promise<File> {
  await document.fonts?.ready
  const name = filename(entry)
  const type = 'image/jpeg'
  const dataUrl = await toJpeg(node, {
    cacheBust: true,
    pixelRatio: 2,
    quality: 0.92,
    backgroundColor: '#f6f1e9',
  })
  return dataUrlToFile(dataUrl, name, type)
}

export async function shareOrDownloadEntryImage(file: File, entry: Entry): Promise<'shared' | 'downloaded'> {
  const shareData = {
    title: `EDABible ${entry.date}`,
    text: entry.bibleRef ? `${entry.date} ${entry.bibleRef}` : entry.date,
    files: [file],
  }

  if (navigator.canShare?.(shareData)) {
    await navigator.share(shareData)
    return 'shared'
  }

  downloadFile(file)
  return 'downloaded'
}

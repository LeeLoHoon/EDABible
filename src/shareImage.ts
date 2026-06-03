import { toJpeg } from 'html-to-image'
import html2canvas from 'html2canvas'
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

function canvasToFile(canvas: HTMLCanvasElement, name: string, type: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('캔버스 이미지를 파일로 변환하지 못했습니다.'))
          return
        }
        resolve(new File([blob], name, { type }))
      },
      type,
      0.92,
    )
  })
}

export async function createEntryImageFile(
  node: HTMLElement,
  entry: Entry,
): Promise<File> {
  await document.fonts?.ready
  const name = filename(entry)
  const type = 'image/jpeg'

  try {
    const dataUrl = await toJpeg(node, {
      cacheBust: true,
      pixelRatio: 2,
      quality: 0.92,
      backgroundColor: '#f6f1e9',
      skipFonts: true,
    })
    return dataUrlToFile(dataUrl, name, type)
  } catch (error) {
    console.warn('html-to-image failed, falling back to html2canvas', error)
  }

  const canvas = await html2canvas(node, {
    backgroundColor: '#f6f1e9',
    scale: Math.min(window.devicePixelRatio || 1, 2),
    useCORS: true,
    logging: false,
  })
  return canvasToFile(canvas, name, type)
}

export async function shareOrDownloadEntryImage(file: File, entry: Entry): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const shareData = {
    title: `EDABible ${entry.date}`,
    text: entry.bibleRef ? `${entry.date} ${entry.bibleRef}` : entry.date,
    files: [file],
  }

  if (navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled'
      }
      console.warn('Web Share failed, falling back to download', error)
    }
  }

  downloadFile(file)
  return 'downloaded'
}

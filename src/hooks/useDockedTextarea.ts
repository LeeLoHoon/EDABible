import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { getVirtualKeyboard } from '../virtualKeyboard'

const EDGE_GAP = 12
const MIN_EDITOR_HEIGHT = 88

/**
 * 가상 키보드가 페이지를 덮는 동안 활성 textarea만 보이는 영역에 둔다.
 * 원래 DOM 자리는 같은 높이로 남겨 페이지 전체가 위아래로 움직이지 않는다.
 */
export function useDockedTextarea() {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRectRef = useRef<DOMRect | null>(null)
  const scrollSnapshotRef = useRef({ top: 0, bottom: 0, caretAtEnd: true })
  const [dock, setDock] = useState<{
    textareaStyle: CSSProperties
    slotHeight: number
  } | null>(null)

  const captureAnchor = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    anchorRectRef.current = textarea.getBoundingClientRect()
    scrollSnapshotRef.current = {
      top: textarea.scrollTop,
      bottom: Math.max(0, textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight),
      caretAtEnd: textarea.selectionEnd === textarea.value.length,
    }
  }, [])

  const syncWithKeyboard = useCallback(() => {
    const textarea = textareaRef.current
    const keyboard = getVirtualKeyboard()
    if (
      !textarea ||
      !keyboard ||
      document.activeElement !== textarea ||
      keyboard.boundingRect.height <= 0
    ) {
      setDock(null)
      return
    }

    const anchor = anchorRectRef.current ?? textarea.getBoundingClientRect()
    anchorRectRef.current = anchor
    if (textarea.style.position !== 'fixed') {
      // focus 이벤트보다 실제 커서 배치가 늦는 브라우저가 있어 키보드가
      // 열리는 순간의 선택·스크롤 상태를 한 번 더 확정한다.
      scrollSnapshotRef.current = {
        top: textarea.scrollTop,
        bottom: Math.max(0, textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight),
        caretAtEnd: textarea.selectionEnd === textarea.value.length,
      }
    }

    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = document.documentElement.clientHeight
    const keyboardTop =
      keyboard.boundingRect.top > 0
        ? keyboard.boundingRect.top
        : viewportHeight - keyboard.boundingRect.height
    const usableBottom = Math.max(EDGE_GAP + MIN_EDITOR_HEIGHT, keyboardTop - EDGE_GAP)
    const preferredTop = Math.max(EDGE_GAP, anchor.top)
    // 원래 위치에 남는 세로 공간만큼 먼저 높이를 줄인다. 최소 높이조차
    // 나오지 않을 때에만 textarea 자체를 위로 옮기며, 문서는 움직이지 않는다.
    const heightAtAnchor = usableBottom - preferredTop
    const height = Math.min(anchor.height, Math.max(MIN_EDITOR_HEIGHT, heightAtAnchor))
    const top = Math.max(EDGE_GAP, Math.min(preferredTop, usableBottom - height))
    const width = Math.min(anchor.width, viewportWidth - EDGE_GAP * 2)
    const left = Math.max(
      EDGE_GAP,
      Math.min(anchor.left, viewportWidth - EDGE_GAP - width),
    )

    setDock({
      slotHeight: anchor.height,
      textareaStyle: {
        position: 'fixed',
        zIndex: 40,
        top,
        left,
        width,
        height,
        minHeight: height,
        maxHeight: height,
        resize: 'none',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        boxShadow: '0 18px 48px rgba(44, 39, 34, 0.24)',
      },
    })
  }, [])

  useEffect(() => {
    const keyboard = getVirtualKeyboard()
    if (!keyboard) return

    keyboard.addEventListener('geometrychange', syncWithKeyboard)
    window.addEventListener('resize', syncWithKeyboard)
    return () => {
      keyboard.removeEventListener('geometrychange', syncWithKeyboard)
      window.removeEventListener('resize', syncWithKeyboard)
    }
  }, [syncWithKeyboard])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !dock) return

    const snapshot = scrollSnapshotRef.current
    // 이어 쓰는 중이면 줄어든 칸에서도 마지막 커서가 보이도록 아래쪽 기준을
    // 보존한다. 중간을 고치는 중이면 사용자가 보던 위쪽 위치를 유지한다.
    textarea.scrollTop = snapshot.caretAtEnd
      ? Math.max(0, textarea.scrollHeight - textarea.clientHeight - snapshot.bottom)
      : snapshot.top
  }, [dock])

  const handleFocus = useCallback(() => {
    captureAnchor()
    requestAnimationFrame(syncWithKeyboard)
  }, [captureAnchor, syncWithKeyboard])

  const handleBlur = useCallback(() => {
    setDock(null)
    anchorRectRef.current = null
  }, [])

  return {
    textareaRef,
    textareaStyle: dock?.textareaStyle,
    slotStyle: dock
      ? ({ height: dock.slotHeight } satisfies CSSProperties)
      : undefined,
    handlePointerDown: captureAnchor,
    handleFocus,
    handleBlur,
  }
}

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
const KEYBOARD_OPEN_TIMEOUT_MS = 2_000

type BodyScrollLock = {
  owner: object
  scrollX: number
  scrollY: number
  bodyStyle: {
    position: string
    top: string
    left: string
    right: string
    width: string
    overflowY: string
  }
}

let bodyScrollLock: BodyScrollLock | null = null

/**
 * Android Blink가 키보드를 띄우며 별도로 실행하는 caret reveal 스크롤의
 * 대상에서 문서를 잠시 제외한다. body를 현재 화면과 같은 위치에 고정하므로
 * native pointer/caret 동작을 취소하지 않고도 본문은 한 픽셀도 움직이지 않는다.
 */
function lockBodyScroll(owner: object) {
  if (bodyScrollLock) {
    // 키보드가 열린 채 다른 입력칸을 누르면 기존 화면 잠금은 유지하고,
    // blur되는 이전 입력칸이 잠금을 풀지 못하도록 소유권만 넘긴다.
    bodyScrollLock.owner = owner
    return
  }

  const body = document.body
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  bodyScrollLock = {
    owner,
    scrollX,
    scrollY,
    bodyStyle: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflowY: body.style.overflowY,
    },
  }

  body.style.position = 'fixed'
  body.style.top = `${-scrollY}px`
  body.style.left = `${-scrollX}px`
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflowY = 'hidden'
}

function unlockBodyScroll(owner: object) {
  const lock = bodyScrollLock
  if (!lock || lock.owner !== owner) return

  const body = document.body
  body.style.position = lock.bodyStyle.position
  body.style.top = lock.bodyStyle.top
  body.style.left = lock.bodyStyle.left
  body.style.right = lock.bodyStyle.right
  body.style.width = lock.bodyStyle.width
  body.style.overflowY = lock.bodyStyle.overflowY
  bodyScrollLock = null

  // 스타일 복구와 같은 task에서 원래 문서 위치까지 돌려 paint 사이의 점프를 막는다.
  window.scrollTo(lock.scrollX, lock.scrollY)
}

/**
 * 가상 키보드가 페이지를 덮는 동안 활성 textarea만 보이는 영역에 둔다.
 * 원래 DOM 자리는 같은 높이로 남겨 페이지 전체가 위아래로 움직이지 않는다.
 */
export function useDockedTextarea() {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const anchorRectRef = useRef<DOMRect | null>(null)
  const scrollSnapshotRef = useRef({ top: 0, bottom: 0, caretAtEnd: true })
  const bodyLockOwnerRef = useRef<object>({})
  const keyboardOpenedRef = useRef(false)
  const unlockTimerRef = useRef<number | null>(null)
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

  const releaseBodyLock = useCallback(() => {
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current)
      unlockTimerRef.current = null
    }
    unlockBodyScroll(bodyLockOwnerRef.current)
  }, [])

  const holdBodyPosition = useCallback(() => {
    lockBodyScroll(bodyLockOwnerRef.current)
    if (unlockTimerRef.current !== null) window.clearTimeout(unlockTimerRef.current)
    // 하드웨어 키보드처럼 geometrychange가 오지 않는 경우에는 문서가
    // 잠긴 채 남지 않도록 자동 해제한다.
    unlockTimerRef.current = window.setTimeout(() => {
      unlockTimerRef.current = null
      if (!keyboardOpenedRef.current) unlockBodyScroll(bodyLockOwnerRef.current)
    }, KEYBOARD_OPEN_TIMEOUT_MS)
  }, [])

  const syncWithKeyboard = useCallback(() => {
    const textarea = textareaRef.current
    const keyboard = getVirtualKeyboard()
    if (!textarea || !keyboard || document.activeElement !== textarea) {
      setDock(null)
      return
    }

    if (keyboard.boundingRect.height <= 0) {
      setDock(null)
      if (keyboardOpenedRef.current) {
        keyboardOpenedRef.current = false
        anchorRectRef.current = null
        releaseBodyLock()
      }
      return
    }

    keyboardOpenedRef.current = true
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current)
      unlockTimerRef.current = null
    }
    // pointerdown을 거치지 않은 프로그램 포커스에도 같은 안전장치를 둔다.
    lockBodyScroll(bodyLockOwnerRef.current)

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
  }, [releaseBodyLock])

  useEffect(() => {
    const keyboard = getVirtualKeyboard()
    if (!keyboard) return

    keyboard.addEventListener('geometrychange', syncWithKeyboard)
    window.addEventListener('resize', syncWithKeyboard)
    return () => {
      keyboard.removeEventListener('geometrychange', syncWithKeyboard)
      window.removeEventListener('resize', syncWithKeyboard)
      keyboardOpenedRef.current = false
      releaseBodyLock()
    }
  }, [releaseBodyLock, syncWithKeyboard])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !dock) return

    const snapshot = scrollSnapshotRef.current
    // 이어 쓰는 중이면 줄어든 칸에서도 마지막 커서가 보이도록 아래쪽 기준을
    // 보존한다. 중간을 고치는 중이면 사용자가 보던 위쪽 위치를 유지한다.
    textarea.scrollTop = snapshot.caretAtEnd
      ? Math.max(0, textarea.scrollHeight - textarea.clientHeight - snapshot.bottom)
      : snapshot.top
    // 이 시점에는 같은 textarea DOM이 이미 fixed로 도킹되고 slot도 원래
    // 높이를 차지한다. paint 전에 문서 잠금을 풀어 최초 점프는 막되,
    // 키보드가 열린 뒤 사용자가 성경을 직접 스크롤하는 동작은 살린다.
    releaseBodyLock()
  }, [dock, releaseBodyLock])

  const handlePointerDown = useCallback(() => {
    const textarea = textareaRef.current
    // 이미 도킹된 입력칸을 다시 누를 때는 원래 anchor를 작은 fixed rect로
    // 덮지 않는다. 네이티브 기본 동작은 그대로 두어 탭한 곳에 커서가 놓인다.
    if (!textarea || textarea.style.position === 'fixed') return
    captureAnchor()
    if (getVirtualKeyboard()) holdBodyPosition()
  }, [captureAnchor, holdBodyPosition])

  const handleFocus = useCallback(() => {
    // pointerdown에서 저장한 pre-focus rect가 있으면 브라우저의 reveal 이후
    // 좌표로 덮지 않는다. 키보드·접근성 포커스에는 여기서 처음 저장한다.
    if (!anchorRectRef.current) captureAnchor()
    if (getVirtualKeyboard()) holdBodyPosition()
    requestAnimationFrame(syncWithKeyboard)
  }, [captureAnchor, holdBodyPosition, syncWithKeyboard])

  const handleBlur = useCallback(() => {
    setDock(null)
    anchorRectRef.current = null
    keyboardOpenedRef.current = false
    releaseBodyLock()
  }, [releaseBodyLock])

  return {
    textareaRef,
    textareaStyle: dock?.textareaStyle,
    slotStyle: dock
      ? ({ height: dock.slotHeight } satisfies CSSProperties)
      : undefined,
    handlePointerDown,
    handleFocus,
    handleBlur,
  }
}

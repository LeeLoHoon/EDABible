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
const MIN_INFERRED_KEYBOARD_HEIGHT = 120

type ViewportMetrics = {
  width: number
  height: number
  innerHeight: number
  layoutHeight: number
  offsetTop: number
  offsetLeft: number
  pageTop: number
  pageLeft: number
  scale: number
}

type KeyboardViewportSession = {
  owner: object
  baseline: ViewportMetrics
  open: boolean
}

type KeyboardGeometry = {
  visibleTop: number
  visibleLeft: number
  visibleWidth: number
  keyboardTop: number
}

let keyboardViewportSession: KeyboardViewportSession | null = null

function readViewportMetrics(): ViewportMetrics {
  const viewport = window.visualViewport
  const offsetTop = viewport?.offsetTop ?? 0
  const offsetLeft = viewport?.offsetLeft ?? 0
  return {
    width: viewport?.width ?? document.documentElement.clientWidth,
    height: viewport?.height ?? window.innerHeight,
    innerHeight: window.innerHeight,
    layoutHeight: document.documentElement.clientHeight,
    offsetTop,
    offsetLeft,
    pageTop: viewport?.pageTop ?? window.scrollY + offsetTop,
    pageLeft: viewport?.pageLeft ?? window.scrollX + offsetLeft,
    scale: viewport?.scale ?? 1,
  }
}

function managesAndroidKeyboard(): boolean {
  if (getVirtualKeyboard()) return true
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

function beginKeyboardViewportSession(owner: object) {
  const current = keyboardViewportSession
  if (current?.owner === owner) return
  if (current?.open) {
    // 키보드가 열린 채 다음 입력칸으로 이동해도 축소되기 전 기준 높이는 유지한다.
    current.owner = owner
    return
  }
  keyboardViewportSession = { owner, baseline: readViewportMetrics(), open: false }
}

function endKeyboardViewportSession(owner: object) {
  if (keyboardViewportSession?.owner === owner) keyboardViewportSession = null
}

function measureKeyboardGeometry(owner: object): KeyboardGeometry | null {
  const session = keyboardViewportSession
  if (!session || session.owner !== owner) return null

  const viewport = readViewportMetrics()
  const keyboard = getVirtualKeyboard()
  if (keyboard && keyboard.boundingRect.height > 0) {
    session.open = true
    return {
      visibleTop: viewport.offsetTop,
      visibleLeft: viewport.offsetLeft,
      visibleWidth: viewport.width,
      keyboardTop:
        keyboard.boundingRect.top > 0
          ? keyboard.boundingRect.top
          : viewport.offsetTop + viewport.height - keyboard.boundingRect.height,
    }
  }

  const baseline = session.baseline
  const sameWidth = Math.abs(viewport.width - baseline.width) < Math.max(24, baseline.width * 0.08)
  const sameScale = Math.abs(viewport.scale - baseline.scale) < 0.02
  if (!sameWidth || !sameScale) return null

  const heightLoss = Math.max(
    baseline.height - viewport.height,
    baseline.innerHeight - viewport.innerHeight,
    baseline.layoutHeight - viewport.layoutHeight,
  )
  const openThreshold = Math.max(
    MIN_INFERRED_KEYBOARD_HEIGHT,
    baseline.height * 0.2,
  )
  const closeThreshold = Math.max(60, baseline.height * 0.08)
  if (heightLoss < (session.open ? closeThreshold : openThreshold)) return null

  session.open = true
  const visibleHeight = Math.min(
    viewport.height,
    viewport.innerHeight,
    viewport.layoutHeight,
  )
  return {
    visibleTop: viewport.offsetTop,
    visibleLeft: viewport.offsetLeft,
    visibleWidth: viewport.width,
    keyboardTop: viewport.offsetTop + visibleHeight,
  }
}

type BodyScrollLock = {
  owner: object
  scrollX: number
  scrollY: number
  pageTop: number
  pageLeft: number
  viewportOffsetTop: number
  viewportOffsetLeft: number
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
  const viewport = readViewportMetrics()
  bodyScrollLock = {
    owner,
    scrollX,
    scrollY,
    pageTop: viewport.pageTop,
    pageLeft: viewport.pageLeft,
    viewportOffsetTop: viewport.offsetTop,
    viewportOffsetLeft: viewport.offsetLeft,
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

function alignLockedBody(owner: object) {
  const lock = bodyScrollLock
  if (!lock || lock.owner !== owner) return
  const viewport = readViewportMetrics()
  document.body.style.top = `${
    -lock.scrollY + (viewport.offsetTop - lock.viewportOffsetTop)
  }px`
  document.body.style.left = `${
    -lock.scrollX + (viewport.offsetLeft - lock.viewportOffsetLeft)
  }px`
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
  const viewport = readViewportMetrics()
  window.scrollTo(
    lock.pageLeft - viewport.offsetLeft,
    lock.pageTop - viewport.offsetTop,
  )
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
      if (!keyboardOpenedRef.current) {
        unlockBodyScroll(bodyLockOwnerRef.current)
        endKeyboardViewportSession(bodyLockOwnerRef.current)
      }
    }, KEYBOARD_OPEN_TIMEOUT_MS)
  }, [])

  const syncWithKeyboard = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || document.activeElement !== textarea) {
      setDock(null)
      return
    }

    const geometry = measureKeyboardGeometry(bodyLockOwnerRef.current)
    if (!geometry) {
      setDock(null)
      if (keyboardOpenedRef.current) {
        keyboardOpenedRef.current = false
        anchorRectRef.current = null
        releaseBodyLock()
        endKeyboardViewportSession(bodyLockOwnerRef.current)
      }
      return
    }

    keyboardOpenedRef.current = true
    if (unlockTimerRef.current !== null) {
      window.clearTimeout(unlockTimerRef.current)
      unlockTimerRef.current = null
    }
    // pointerdown을 거치지 않은 프로그램 포커스에도 같은 안전장치를 두고,
    // VisualViewport가 pan된 기기에서는 고정한 본문의 화면 좌표를 보정한다.
    if (textarea.style.position !== 'fixed') lockBodyScroll(bodyLockOwnerRef.current)
    alignLockedBody(bodyLockOwnerRef.current)

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

    const baseline = keyboardViewportSession?.baseline
    const topOffset = baseline ? geometry.visibleTop - baseline.offsetTop : 0
    const leftOffset = baseline ? geometry.visibleLeft - baseline.offsetLeft : 0
    const visibleTop = geometry.visibleTop + EDGE_GAP
    const usableBottom = Math.max(
      visibleTop + MIN_EDITOR_HEIGHT,
      geometry.keyboardTop - EDGE_GAP,
    )
    const preferredTop = Math.max(visibleTop, anchor.top + topOffset)
    // 원래 위치에 남는 세로 공간만큼 먼저 높이를 줄인다. 최소 높이조차
    // 나오지 않을 때에만 textarea 자체를 위로 옮기며, 문서는 움직이지 않는다.
    const heightAtAnchor = usableBottom - preferredTop
    const height = Math.min(anchor.height, Math.max(MIN_EDITOR_HEIGHT, heightAtAnchor))
    const top = Math.max(visibleTop, Math.min(preferredTop, usableBottom - height))
    const width = Math.min(anchor.width, geometry.visibleWidth - EDGE_GAP * 2)
    const visibleLeft = geometry.visibleLeft + EDGE_GAP
    const visibleRight = geometry.visibleLeft + geometry.visibleWidth - EDGE_GAP
    const left = Math.max(
      visibleLeft,
      Math.min(anchor.left + leftOffset, visibleRight - width),
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
    const viewport = window.visualViewport
    const owner = bodyLockOwnerRef.current
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return
      keyboardOpenedRef.current = false
      releaseBodyLock()
      endKeyboardViewportSession(owner)
    }

    keyboard?.addEventListener('geometrychange', syncWithKeyboard)
    viewport?.addEventListener('resize', syncWithKeyboard)
    viewport?.addEventListener('scroll', syncWithKeyboard)
    window.addEventListener('resize', syncWithKeyboard)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      keyboard?.removeEventListener('geometrychange', syncWithKeyboard)
      viewport?.removeEventListener('resize', syncWithKeyboard)
      viewport?.removeEventListener('scroll', syncWithKeyboard)
      window.removeEventListener('resize', syncWithKeyboard)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      keyboardOpenedRef.current = false
      releaseBodyLock()
      endKeyboardViewportSession(owner)
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
    // 본문 잠금은 키보드가 닫힐 때까지 유지한다. Blink가 geometrychange 뒤에
    // 늦게 caret reveal을 다시 실행해도 성경 화면은 움직이지 않는다.
  }, [dock])

  const handlePointerDown = useCallback(() => {
    const textarea = textareaRef.current
    // 이미 도킹된 입력칸을 다시 누를 때는 원래 anchor를 작은 fixed rect로
    // 덮지 않는다. 네이티브 기본 동작은 그대로 두어 탭한 곳에 커서가 놓인다.
    if (!textarea || textarea.style.position === 'fixed') return
    captureAnchor()
    if (managesAndroidKeyboard()) {
      beginKeyboardViewportSession(bodyLockOwnerRef.current)
      holdBodyPosition()
    }
  }, [captureAnchor, holdBodyPosition])

  const handleFocus = useCallback(() => {
    // pointerdown에서 저장한 pre-focus rect가 있으면 브라우저의 reveal 이후
    // 좌표로 덮지 않는다. 키보드·접근성 포커스에는 여기서 처음 저장한다.
    if (!anchorRectRef.current) captureAnchor()
    if (managesAndroidKeyboard()) {
      beginKeyboardViewportSession(bodyLockOwnerRef.current)
      holdBodyPosition()
    }
    requestAnimationFrame(syncWithKeyboard)
  }, [captureAnchor, holdBodyPosition, syncWithKeyboard])

  const handleBlur = useCallback(() => {
    setDock(null)
    anchorRectRef.current = null
    keyboardOpenedRef.current = false
    // 키보드의 '다음'으로 다른 textarea에 이동할 때 새 hook이 같은 task에서
    // session/lock 소유권을 넘겨받을 시간을 준다.
    requestAnimationFrame(() => {
      releaseBodyLock()
      endKeyboardViewportSession(bodyLockOwnerRef.current)
    })
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

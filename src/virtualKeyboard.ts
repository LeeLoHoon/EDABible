/**
 * Chromium 계열의 VirtualKeyboard API 최소 표면.
 * 아직 TypeScript DOM 타입에 포함되지 않은 환경에서도 기능 감지로 안전하게 쓴다.
 */
export interface VirtualKeyboardController extends EventTarget {
  overlaysContent: boolean
  readonly boundingRect: DOMRectReadOnly
}

export function getVirtualKeyboard(): VirtualKeyboardController | null {
  if (typeof navigator === 'undefined') return null
  return (
    navigator as Navigator & {
      virtualKeyboard?: VirtualKeyboardController
    }
  ).virtualKeyboard ?? null
}

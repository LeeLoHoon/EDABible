/**
 * SPL PDF와 같은 모던 고딕(Pretendard)을 한 번만 로드한다.
 *
 * 바인더 단독 배포는 화면 전체 폰트를 이 글꼴로 바꾸고, 통합(all) 배포는 바인더 화면의
 * 입력칸만 이 글꼴을 쓴다. 두 경우 모두 바인더 화면을 열 때 필요하므로 로드를 여기 모은다.
 * dynamic subset이라 화면에 쓰인 글리프만 내려받고, 오프라인이면 시스템 고딕으로 폴백한다.
 */
const FONT_HREF =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'

let requested = false

export function ensureBinderFont(): void {
  if (requested || typeof document === 'undefined') return
  requested = true
  if (document.querySelector(`link[href="${FONT_HREF}"]`)) return

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONT_HREF
  document.head.appendChild(link)
}

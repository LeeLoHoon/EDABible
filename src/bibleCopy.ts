const BIBLE_COPY_CLASS = 'dev-bible-copy-enabled'

export const isBibleCopyEnabled = (): boolean =>
  document.documentElement.classList.contains(BIBLE_COPY_CLASS)

/** 현재 페이지 세션에서만 본문 선택·복사를 허용한다. 새로고침하면 자동으로 잠긴다. */
export const enableBibleCopy = (): void => {
  document.documentElement.classList.add(BIBLE_COPY_CLASS)
}

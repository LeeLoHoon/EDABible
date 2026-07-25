export type Lang = 'ko' | 'en'

export const LANG_STORAGE_KEY = 'edabible:lang'

let memoizedLang: Lang | null = null

export function getLang(): Lang {
  if (memoizedLang) return memoizedLang

  try {
    memoizedLang = localStorage.getItem(LANG_STORAGE_KEY) === 'en' ? 'en' : 'ko'
  } catch {
    memoizedLang = 'ko'
  }
  return memoizedLang
}

export function setStoredLang(lang: Lang): void {
  localStorage.setItem(LANG_STORAGE_KEY, lang)
}

/** 한국어 성경 역본 선택 상태. 언어(lang)와 별개 축 — 영어 모드에서는 무시된다.
    msg = 메시지성경(기본·편집 가능), gae = 개역개정, sae = 새번역. */

export type BibleVersion = 'msg' | 'gae' | 'sae'

export const BIBLE_VERSION_STORAGE_KEY = 'edabible:bibleVersion'

export const BIBLE_VERSIONS: readonly BibleVersion[] = ['msg', 'gae', 'sae']

function isBibleVersion(value: string | null): value is BibleVersion {
  return value === 'msg' || value === 'gae' || value === 'sae'
}

let memoizedVersion: BibleVersion | null = null

export function getBibleVersion(): BibleVersion {
  if (memoizedVersion) return memoizedVersion

  try {
    const stored = localStorage.getItem(BIBLE_VERSION_STORAGE_KEY)
    if (isBibleVersion(stored)) {
      memoizedVersion = stored
      return memoizedVersion
    }

    memoizedVersion = 'msg'
    if (stored !== null) {
      try {
        localStorage.setItem(BIBLE_VERSION_STORAGE_KEY, memoizedVersion)
      } catch (error) {
        console.warn('Invalid Bible version could not be repaired in localStorage.', error)
      }
    }
  } catch {
    memoizedVersion = 'msg'
  }
  return memoizedVersion
}

export function setBibleVersion(version: BibleVersion): void {
  memoizedVersion = version
  try {
    localStorage.setItem(BIBLE_VERSION_STORAGE_KEY, version)
  } catch {
    // 저장 실패해도 세션 내 전환은 유지된다
  }
}

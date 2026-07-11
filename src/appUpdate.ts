export interface AppUpdateState {
  latestVersion: string | null
  refreshing: boolean
}

let state: AppUpdateState = {
  latestVersion: null,
  refreshing: false,
}

const listeners = new Set<() => void>()

export function subscribeToAppUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAppUpdateState(): AppUpdateState {
  return state
}

export function announceAppUpdate(latestVersion: string): void {
  if (state.latestVersion && !isNewerVersion(latestVersion, state.latestVersion)) return
  state = { latestVersion, refreshing: false }
  listeners.forEach((listener) => listener())
}

export function setAppUpdateRefreshing(refreshing: boolean): void {
  if (state.refreshing === refreshing) return
  state = { ...state, refreshing }
  listeners.forEach((listener) => listener())
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 서버 캐시가 잠시 이전 값을 돌려줘도 업데이트 안내를 띄우지 않는다. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const active = parseVersion(current)
  if (!next || !active) return false

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== active[index]) return next[index] > active[index]
  }
  return false
}

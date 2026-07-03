// 리로드·이탈 직전에 대기 중인 디바운스 저장을 확정하기 위한 flush 레지스트리.
// 저장 주체(useEntry 등)가 flush 함수를 등록하고, main.tsx가 SW 업데이트
// 리로드 직전에 전부 실행해 필기 유실을 막는다.
type Flush = () => Promise<void>

const flushers = new Set<Flush>()

export function registerSaveFlush(fn: Flush): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

export async function flushPendingSaves(): Promise<void> {
  await Promise.allSettled([...flushers].map((fn) => fn()))
}

/** 같은 key의 비동기 저장을 호출 순서대로 실행하며 각 호출에는 자체 오류를 돌려준다. */
export class SerializedSaveQueue {
  private readonly tails = new Map<string, Promise<void>>()

  run(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.tails.set(key, current)
    void current.then(
      () => this.removeIfCurrent(key, current),
      () => this.removeIfCurrent(key, current),
    )
    return current
  }

  private removeIfCurrent(key: string, current: Promise<void>): void {
    if (this.tails.get(key) === current) this.tails.delete(key)
  }
}

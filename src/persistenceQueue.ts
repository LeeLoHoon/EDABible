/** Serializes tasks while retaining only a resolved tail after each task settles. */
export class ResolvedTaskChain {
  private tail: Promise<void> = Promise.resolve()
  private active: Promise<void> | null = null

  run(task: () => Promise<void>): Promise<void> {
    const current = this.tail.then(task)
    this.tail = current.then(
      () => undefined,
      () => undefined,
    )
    this.active = current
    void current.then(
      () => {
        if (this.active === current) this.active = null
      },
      () => {
        if (this.active === current) this.active = null
      },
    )
    return current
  }

  wait(): Promise<void> {
    return this.tail
  }

  waitForCurrent(): Promise<void> {
    return this.active ?? this.tail
  }

  reset(): void {
    this.tail = Promise.resolve()
    this.active = null
  }
}

export async function drainPendingRef<T>(
  pendingRef: { current: T | null },
  save: (value: T) => Promise<void>,
): Promise<void> {
  while (pendingRef.current) {
    const current = pendingRef.current
    await save(current)
    if (pendingRef.current === current) pendingRef.current = null
  }
}

export function runSingleFlight(
  activeRef: { current: Promise<void> | null },
  task: () => Promise<void>,
): Promise<void> {
  if (activeRef.current) return activeRef.current
  const current = Promise.resolve().then(task)
  activeRef.current = current
  void current.then(
    () => {
      if (activeRef.current === current) activeRef.current = null
    },
    () => {
      if (activeRef.current === current) activeRef.current = null
    },
  )
  return current
}

/** A single-flight drain where newer pending values win if an older save fails. */
export class LatestValueDrain<T> {
  private pending: T | null = null
  private active: Promise<void> | null = null

  schedule(value: T): void {
    this.pending = value
  }

  getPending(): T | null {
    return this.pending
  }

  clearPending(): void {
    this.pending = null
  }

  flush(save: (value: T) => Promise<void>): Promise<void> {
    if (this.active) return this.active
    const current = Promise.resolve().then(() => this.drain(save))
    this.active = current
    return current
  }

  private async drain(save: (value: T) => Promise<void>): Promise<void> {
    try {
      while (this.pending) {
        const current = this.pending
        this.pending = null
        try {
          await save(current)
        } catch (error) {
          if (!this.pending) this.pending = current
          throw error
        }
      }
    } finally {
      this.active = null
    }

    if (this.pending) await this.flush(save)
  }
}

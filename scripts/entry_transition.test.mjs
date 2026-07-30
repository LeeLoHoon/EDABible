import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
})
const transition = await server.ssrLoadModule('/src/entryTransition.ts')

after(async () => {
  await server.close()
})

function ports(overrides = {}) {
  return {
    getPendingId: () => undefined,
    flushPending: async () => undefined,
    clearExposedEntry: () => undefined,
    loadEntry: async () => undefined,
    isCurrent: () => true,
    ...overrides,
  }
}

function entry(id) {
  return { id, updatedAt: 1 }
}

test('이미 loaded된 id 요청은 아무 작업 없이 aborted된다', async () => {
  const calls = []
  const result = await transition.runEntryTransition(
    'entry-a',
    'entry-a',
    ports({
      clearExposedEntry: () => calls.push('clear'),
      loadEntry: async () => calls.push('load'),
    }),
  )
  assert.equal(result, 'aborted')
  assert.deepEqual(calls, [])
})

test('이미 loaded된 id라도 foreign pending이 있으면 먼저 flush하고 다시 load한다', async () => {
  const calls = []
  const result = await transition.runEntryTransition(
    'entry-a',
    'entry-a',
    ports({
      getPendingId: () => 'entry-b',
      clearExposedEntry: () => calls.push('clear'),
      flushPending: async () => calls.push('flush'),
      loadEntry: async (id) => calls.push(`load:${id}`),
    }),
  )
  assert.equal(result, 'loaded')
  assert.deepEqual(calls, ['clear', 'flush', 'load:entry-a'])
})

test('pending이 없는 A→B는 B만 load한다', async () => {
  const calls = []
  const result = await transition.runEntryTransition(
    'entry-b',
    'entry-a',
    ports({
      clearExposedEntry: () => calls.push('clear'),
      loadEntry: async (id) => calls.push(`load:${id}`),
    }),
  )
  assert.equal(result, 'loaded')
  assert.deepEqual(calls, ['load:entry-b'])
})

test('pending A가 있으면 A를 숨기고 flush한 뒤 B를 load한다', async () => {
  const calls = []
  const result = await transition.runEntryTransition(
    'entry-b',
    'entry-a',
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => calls.push('clear'),
      flushPending: async () => calls.push('flush'),
      loadEntry: async (id) => calls.push(`load:${id}`),
    }),
  )
  assert.equal(result, 'loaded')
  assert.deepEqual(calls, ['clear', 'flush', 'load:entry-b'])
})

test('old pending flush 실패 시 새 entry load를 차단한다', async () => {
  const calls = []
  const result = await transition.runEntryTransition(
    'entry-b',
    'entry-a',
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => calls.push('clear'),
      flushPending: async () => {
        calls.push('flush')
        throw new Error('flush failed')
      },
      loadEntry: async () => calls.push('load'),
    }),
  )
  assert.equal(result, 'blocked')
  assert.deepEqual(calls, ['clear', 'flush'])
})

test('undefined 전환도 pending을 먼저 flush하며 실패하면 blocked된다', async () => {
  const successCalls = []
  const success = await transition.runEntryTransition(
    undefined,
    'entry-a',
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => successCalls.push('clear'),
      flushPending: async () => successCalls.push('flush'),
      loadEntry: async () => successCalls.push('load'),
    }),
  )
  assert.equal(success, 'cleared')
  assert.deepEqual(successCalls, ['clear', 'flush', 'clear'])

  const failureCalls = []
  const failure = await transition.runEntryTransition(
    undefined,
    'entry-a',
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => failureCalls.push('clear'),
      flushPending: async () => {
        failureCalls.push('flush')
        throw new Error('flush failed')
      },
      loadEntry: async () => failureCalls.push('load'),
    }),
  )
  assert.equal(failure, 'blocked')
  assert.deepEqual(failureCalls, ['clear', 'flush'])
})

test('undefined 전환 flush 실패는 invalid UI sentinel로 loading barrier를 보존한다', async () => {
  const state = {
    loadedRef: 'entry-a',
    loadedState: 'entry-a',
    exposedId: 'entry-a',
  }
  const requestedId = undefined
  const result = await transition.runEntryTransition(
    requestedId,
    state.loadedRef,
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => {
        state.exposedId = undefined
        state.loadedRef = undefined
        state.loadedState = null
      },
      flushPending: async () => {
        throw new Error('flush failed')
      },
    }),
  )

  assert.equal(result, 'blocked')
  assert.equal(state.exposedId, undefined)
  assert.equal(state.loadedRef, undefined)
  assert.equal(state.loadedState, null)
  assert.equal(requestedId !== state.loadedState, true)
})

test('A→B→C에서 stale B transition은 flush/load 경계에서 abort된다', async () => {
  const beforeLoadCalls = []
  const beforeLoad = await transition.runEntryTransition(
    'entry-b',
    'entry-a',
    ports({
      getPendingId: () => 'entry-a',
      clearExposedEntry: () => beforeLoadCalls.push('clear'),
      flushPending: async () => beforeLoadCalls.push('flush'),
      isCurrent: () => false,
      loadEntry: async () => beforeLoadCalls.push('load'),
    }),
  )
  assert.equal(beforeLoad, 'aborted')
  assert.deepEqual(beforeLoadCalls, ['clear', 'flush'])

  const afterLoadCalls = []
  const afterLoad = await transition.runEntryTransition(
    'entry-b',
    'entry-a',
    ports({
      loadEntry: async () => afterLoadCalls.push('load'),
      isCurrent: () => false,
    }),
  )
  assert.equal(afterLoad, 'aborted')
  assert.deepEqual(afterLoadCalls, ['load'])
})

test('pending A를 숨긴 A→B 도중 A로 돌아오면 A를 다시 load하고 stale B를 abort한다', async () => {
  const state = {
    activeId: 'entry-b',
    loadedId: 'entry-a',
    exposedId: 'entry-a',
    pendingId: 'entry-a',
  }
  let releaseFlush
  let markFlushStarted
  const flushStarted = new Promise((resolve) => {
    markFlushStarted = resolve
  })
  const flushGate = new Promise((resolve) => {
    releaseFlush = resolve
  })
  const transitionToB = transition.runEntryTransition(
    'entry-b',
    state.loadedId,
    ports({
      getPendingId: () => state.pendingId,
      clearExposedEntry: () => {
        state.exposedId = undefined
        state.loadedId = undefined
      },
      flushPending: async () => {
        markFlushStarted()
        await flushGate
        state.pendingId = undefined
      },
      loadEntry: async (id) => {
        state.exposedId = id
        state.loadedId = id
      },
      isCurrent: (id) => state.activeId === id,
    }),
  )

  await flushStarted
  assert.equal(state.exposedId, undefined)
  assert.equal(state.loadedId, undefined)

  state.activeId = 'entry-a'
  const transitionBackToA = await transition.runEntryTransition(
    'entry-a',
    state.loadedId,
    ports({
      getPendingId: () => state.pendingId,
      loadEntry: async (id) => {
        state.exposedId = state.pendingId === id ? state.pendingId : id
        state.loadedId = id
      },
      isCurrent: (id) => state.activeId === id,
    }),
  )
  assert.equal(transitionBackToA, 'loaded')
  assert.equal(state.exposedId, 'entry-a')
  assert.equal(state.loadedId, 'entry-a')

  releaseFlush()
  assert.equal(await transitionToB, 'aborted')
  assert.equal(state.exposedId, 'entry-a')
  assert.equal(state.loadedId, 'entry-a')
})

test('B 전환 flush 실패 후 A로 돌아오면 invalidated marker 때문에 A를 다시 load한다', async () => {
  const state = {
    activeId: 'entry-b',
    loadedId: 'entry-a',
    exposedId: 'entry-a',
    pendingId: 'entry-a',
  }
  const blocked = await transition.runEntryTransition(
    'entry-b',
    state.loadedId,
    ports({
      getPendingId: () => state.pendingId,
      clearExposedEntry: () => {
        state.exposedId = undefined
        state.loadedId = undefined
      },
      flushPending: async () => {
        throw new Error('flush failed')
      },
      isCurrent: (id) => state.activeId === id,
    }),
  )
  assert.equal(blocked, 'blocked')

  state.activeId = 'entry-a'
  const restored = await transition.runEntryTransition(
    'entry-a',
    state.loadedId,
    ports({
      getPendingId: () => state.pendingId,
      loadEntry: async (id) => {
        state.exposedId = id
        state.loadedId = id
      },
      isCurrent: (id) => state.activeId === id,
    }),
  )
  assert.equal(restored, 'loaded')
  assert.equal(state.exposedId, 'entry-a')
  assert.equal(state.loadedId, 'entry-a')
})

test('pending flush 뒤 B load 실패 후 A로 돌아와도 A를 다시 load한다', async () => {
  const state = {
    activeId: 'entry-b',
    loadedId: 'entry-a',
    exposedId: 'entry-a',
    pendingId: 'entry-a',
  }
  await assert.rejects(
    transition.runEntryTransition(
      'entry-b',
      state.loadedId,
      ports({
        getPendingId: () => state.pendingId,
        clearExposedEntry: () => {
          state.exposedId = undefined
          state.loadedId = undefined
        },
        flushPending: async () => {
          state.pendingId = undefined
        },
        loadEntry: async () => {
          throw new Error('load failed')
        },
        isCurrent: (id) => state.activeId === id,
      }),
    ),
    /load failed/,
  )

  state.activeId = 'entry-a'
  const restored = await transition.runEntryTransition(
    'entry-a',
    state.loadedId,
    ports({
      loadEntry: async (id) => {
        state.exposedId = id
        state.loadedId = id
      },
      isCurrent: (id) => state.activeId === id,
    }),
  )
  assert.equal(restored, 'loaded')
  assert.equal(state.exposedId, 'entry-a')
  assert.equal(state.loadedId, 'entry-a')
})

test('route 복귀 recovery는 같은 id의 pending과 journal 중 최신 snapshot을 선택한다', () => {
  const pendingA = entry('entry-a')
  const journalA = { ...entry('entry-a'), updatedAt: 2 }

  assert.equal(transition.selectLatestEntryRecovery(pendingA, undefined), pendingA)
  assert.equal(transition.selectLatestEntryRecovery(undefined, journalA), journalA)
  assert.equal(transition.selectLatestEntryRecovery(pendingA, journalA), journalA)
  const tiedPending = { ...pendingA, updatedAt: 2 }
  assert.equal(transition.selectLatestEntryRecovery(tiedPending, journalA), tiedPending)
})

test('startup route와 다른 journal만 transition pending으로 승격한다', () => {
  const pendingA = entry('entry-a')
  const journalA = { ...entry('entry-a'), updatedAt: 2 }

  assert.equal(transition.selectTransitionPending('entry-b', pendingA, journalA), pendingA)
  assert.equal(transition.selectTransitionPending('entry-b', null, journalA), journalA)
  assert.equal(transition.selectTransitionPending('entry-a', null, journalA), null)
  assert.equal(transition.selectTransitionPending(undefined, null, journalA), journalA)
  assert.equal(transition.selectTransitionPending('entry-b', null, undefined), null)
})

test('update base는 active/loaded/ref id가 모두 맞을 때만 선택한다', () => {
  const pendingA = entry('entry-a')
  const exposedA = entry('entry-a')
  const exposedB = entry('entry-b')

  assert.equal(transition.selectUpdateBase(undefined, 'entry-a', pendingA, exposedA), null)
  assert.equal(transition.selectUpdateBase('entry-b', 'entry-a', pendingA, exposedB), null)
  assert.equal(transition.selectUpdateBase('entry-b', 'entry-b', pendingA, exposedB), exposedB)
  assert.equal(transition.selectUpdateBase('entry-a', 'entry-a', pendingA, exposedA), pendingA)
  assert.equal(transition.selectUpdateBase('entry-b', 'entry-b', pendingA, exposedA), null)
})

test('retry helper는 첫 실패 후 500ms wait를 거쳐 성공한다', async () => {
  const waits = []
  let attempts = 0
  const result = await transition.retryEntryOperation(
    async (attempt) => {
      attempts += 1
      if (attempt === 1) throw new Error('transient')
      return 'saved'
    },
    async (delay) => {
      waits.push(delay)
    },
  )

  assert.equal(result, 'saved')
  assert.equal(attempts, 2)
  assert.deepEqual(waits, [500])
})

test('retry helper는 정확히 3회 실패하고 manual retry는 새 cycle을 시작한다', async () => {
  const waits = []
  let attempts = 0
  const operation = async () => {
    attempts += 1
    if (attempts <= 3) throw new Error(`failure-${attempts}`)
    return 'saved-on-manual-retry'
  }
  const wait = async (delay) => {
    waits.push(delay)
  }

  await assert.rejects(transition.retryEntryOperation(operation, wait), /failure-3/)
  assert.equal(attempts, 3)
  assert.deepEqual(waits, [500, 1000])

  const result = await transition.retryEntryOperation(operation, wait)
  assert.equal(result, 'saved-on-manual-retry')
  assert.equal(attempts, 4)
  assert.deepEqual(waits, [500, 1000])
})

test('multiple foreign journals는 ID 순서로 drain 대상으로 선택되고 requested journal은 제외된다', () => {
  const pendingC = { ...entry('entry-c'), updatedAt: 3 }
  const journals = [
    { ...entry('entry-c'), updatedAt: 2 },
    entry('entry-b'),
    entry('entry-a'),
  ]

  const selected = transition.selectForeignEntryRecoveries('entry-b', pendingC, journals)
  assert.deepEqual(
    selected.map((candidate) => [candidate.id, candidate.updatedAt]),
    [
      ['entry-a', 1],
      ['entry-c', 3],
    ],
  )
})

test('failed A→B 뒤 새 hook cycle도 A recovery를 B load 전에 drain한다', async () => {
  const survivingJournals = [{ ...entry('entry-a'), updatedAt: 5 }]
  const firstCycleCalls = []
  const firstRecoveries = transition.selectForeignEntryRecoveries(
    'entry-b',
    null,
    survivingJournals,
  )
  await assert.rejects(
    transition.retryEntryOperation(
      async (attempt) => {
        firstCycleCalls.push(`commit-a:${attempt}`)
        throw new Error('offline')
      },
      async () => undefined,
    ),
    /offline/,
  )
  assert.deepEqual(firstRecoveries.map((candidate) => candidate.id), ['entry-a'])
  assert.deepEqual(firstCycleCalls, ['commit-a:1', 'commit-a:2', 'commit-a:3'])

  const reloadCalls = []
  const reloadRecoveries = transition.selectForeignEntryRecoveries(
    'entry-b',
    null,
    survivingJournals,
  )
  for (const recovery of reloadRecoveries) {
    await transition.retryEntryOperation(
      async () => {
        reloadCalls.push(`commit:${recovery.id}`)
      },
      async () => undefined,
    )
  }
  await transition.runEntryTransition(
    'entry-b',
    undefined,
    ports({ loadEntry: async (id) => reloadCalls.push(`load:${id}`) }),
  )
  assert.deepEqual(reloadCalls, ['commit:entry-a', 'load:entry-b'])
})

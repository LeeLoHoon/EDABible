import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { QA_BACKFILL_DIMENSION, backfillQaEmbeddings } from './backfill_qa_embeddings.mjs'

const knownBody = 'KNOWN_PUBLISHED_ANSWER_BODY'
const vectorValue = 0.123456789
const vector = Array(QA_BACKFILL_DIMENSION).fill(vectorValue)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function chunk(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    body: knownBody,
    content_hash: sha256(knownBody),
    created_at: '2026-01-01T00:00:00.000Z',
    source: { source_kind: 'published_answer', active: true },
    ...overrides,
  }
}

function successfulResponse(count) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector })),
    }),
  }
}

function mockClient(data, rpcErrors = []) {
  const queryCalls = []
  const rpcCalls = []
  const query = {
    select(value) {
      queryCalls.push(['select', value])
      return this
    },
    is(column, value) {
      queryCalls.push(['is', column, value])
      return this
    },
    eq(column, value) {
      queryCalls.push(['eq', column, value])
      return this
    },
    order(column, options) {
      queryCalls.push(['order', column, options])
      return this
    },
    limit(value) {
      queryCalls.push(['limit', value])
      return this
    },
    then(resolveThen) {
      resolveThen({ data, error: null })
    },
  }
  return {
    queryCalls,
    rpcCalls,
    from(table) {
      queryCalls.push(['from', table])
      return query
    },
    async rpc(name, parameters) {
      rpcCalls.push([name, parameters])
      return { data: null, error: rpcErrors[rpcCalls.length - 1] ?? null }
    },
  }
}

const cases = [
  {
    name: 'only active published-answer NULL chunks selected and processed',
    run: async () => {
      const client = mockClient([
        chunk(),
        chunk({ id: 'inactive', source: { source_kind: 'published_answer', active: false } }),
        chunk({ id: 'historical', source: { source_kind: 'historical_qa', active: true } }),
      ])
      let requestBodies
      const summary = await backfillQaEmbeddings({
        client,
        apply: true,
        apiKey: 'test-key-not-logged',
        fetchImpl: async (_url, options) => {
          requestBodies = JSON.parse(options.body).input
          return successfulResponse(1)
        },
      })
      assert.deepEqual(requestBodies, [knownBody])
      assert.equal(client.rpcCalls.length, 1)
      assert.equal(summary.eligibleCount, 1)
      assert.equal(summary.backfilled, 1)
      assert.ok(client.queryCalls.some((call) => call[0] === 'is' && call[1] === 'embedding' && call[2] === null))
      assert.ok(client.queryCalls.some((call) => call[0] === 'eq' && call[1] === 'source.source_kind' && call[2] === 'published_answer'))
      assert.ok(client.queryCalls.some((call) => call[0] === 'eq' && call[1] === 'source.active' && call[2] === true))
      assert.ok(client.queryCalls.some((call) => call[0] === 'order' && call[1] === 'created_at' && call[2].ascending === true))
    },
  },
  {
    name: 'local hash mismatch skips and RPC is not called',
    run: async () => {
      const client = mockClient([chunk({ content_hash: '0'.repeat(64) })])
      let fetchCalls = 0
      const summary = await backfillQaEmbeddings({
        client,
        apply: true,
        apiKey: 'test-key-not-logged',
        fetchImpl: async () => {
          fetchCalls += 1
          return successfulResponse(1)
        },
      })
      assert.equal(fetchCalls, 0)
      assert.equal(client.rpcCalls.length, 0)
      assert.equal(summary.skipped, 1)
    },
  },
  {
    name: 'dry-run performs no fetch or RPC writes',
    run: async () => {
      const client = mockClient([chunk()])
      let fetchCalls = 0
      const summary = await backfillQaEmbeddings({
        client,
        fetchImpl: async () => {
          fetchCalls += 1
          return successfulResponse(1)
        },
      })
      assert.equal(summary.mode, 'dry-run')
      assert.equal(summary.verifiedCount, 1)
      assert.equal(summary.backfilled, 0)
      assert.equal(fetchCalls, 0)
      assert.equal(client.rpcCalls.length, 0)
    },
  },
  {
    name: 'stale and precondition RPC errors become skips',
    run: async () => {
      const secondBody = `${knownBody}_SECOND`
      const client = mockClient(
        [
          chunk(),
          chunk({
            id: '00000000-0000-4000-8000-000000000002',
            body: secondBody,
            content_hash: sha256(secondBody),
          }),
        ],
        [
          { message: 'QA_BACKFILL_STALE' },
          { message: 'QA_BACKFILL_PRECONDITION_FAILED' },
        ],
      )
      const summary = await backfillQaEmbeddings({
        client,
        apply: true,
        apiKey: 'test-key-not-logged',
        fetchImpl: async () => successfulResponse(2),
      })
      assert.equal(client.rpcCalls.length, 2)
      assert.equal(summary.backfilled, 0)
      assert.equal(summary.skipped, 2)
    },
  },
  {
    name: 'summary contains no body or vector',
    run: async () => {
      const client = mockClient([chunk()])
      const summary = await backfillQaEmbeddings({ client })
      const output = JSON.stringify(summary)
      assert.equal(output.includes(knownBody), false)
      assert.equal(output.includes(String(vectorValue)), false)
      assert.equal('body' in summary, false)
      assert.equal('embedding' in summary, false)
    },
  },
]

for (const entry of cases) test(`Q&A backfill: ${entry.name}`, entry.run)

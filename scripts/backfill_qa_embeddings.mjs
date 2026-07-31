import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export const QA_BACKFILL_MODEL = 'text-embedding-3-small'
export const QA_BACKFILL_DIMENSION = 1536
export const QA_BACKFILL_DEFAULT_LIMIT = 50
export const QA_BACKFILL_MAX_LIMIT = 500

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const MAX_BATCH_SIZE = 64
const MAX_ATTEMPTS = 5

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceMetadata(row) {
  if (Array.isArray(row.source)) return row.source[0]
  return row.source
}

function isEligibleChunk(row) {
  const source = row && typeof row === 'object' ? sourceMetadata(row) : null
  return (
    row &&
    typeof row === 'object' &&
    typeof row.id === 'string' &&
    typeof row.body === 'string' &&
    typeof row.content_hash === 'string' &&
    source &&
    source.source_kind === 'published_answer' &&
    source.active === true
  )
}

function validateEmbedding(value) {
  if (
    !Array.isArray(value) ||
    value.length !== QA_BACKFILL_DIMENSION ||
    !value.every((number) => typeof number === 'number' && Number.isFinite(number))
  ) {
    throw new Error(`OpenAI embedding must contain ${QA_BACKFILL_DIMENSION} finite numbers`)
  }
  return value
}

async function requestEmbeddingBatch({ bodies, apiKey, fetchImpl, sleep, random }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: bodies,
        model: QA_BACKFILL_MODEL,
        dimensions: QA_BACKFILL_DIMENSION,
      }),
    })
    if (response.ok) {
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error('OpenAI embeddings returned invalid JSON')
      }
      if (!payload || !Array.isArray(payload.data) || payload.data.length !== bodies.length) {
        throw new Error('OpenAI embeddings returned an invalid batch')
      }
      const ordered = [...payload.data].sort((left, right) => left.index - right.index)
      if (ordered.some((item, index) => item.index !== index)) {
        throw new Error('OpenAI embeddings returned invalid indices')
      }
      return ordered.map((item) => validateEmbedding(item.embedding))
    }

    const retryable = response.status === 429 || response.status >= 500
    if (!retryable) throw new Error(`OpenAI embeddings request failed with status ${response.status}`)
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`OpenAI embeddings request failed after ${MAX_ATTEMPTS} attempts`)
    }
    const delay = Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(random() * 100)
    await sleep(delay)
  }
  throw new Error('OpenAI embeddings retry state is invalid')
}

export async function selectBackfillCandidates(client, limit) {
  const { data, error } = await client
    .from('qa_chunks')
    .select('id, body, content_hash, created_at, source:qa_sources!inner(source_kind, active)')
    .is('embedding', null)
    .eq('source.source_kind', 'published_answer')
    .eq('source.active', true)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error('Approved chunk lookup failed')
  if (!Array.isArray(data)) throw new Error('Approved chunk lookup returned invalid data')
  return data
}

function isSkippableRpcError(error) {
  if (!error || typeof error !== 'object') return false
  const values = [error.message, error.code, error.details, error.hint]
    .filter((value) => typeof value === 'string')
    .join(' ')
  return values.includes('QA_BACKFILL_STALE') || values.includes('QA_BACKFILL_PRECONDITION_FAILED')
}

export async function backfillQaEmbeddings({
  client,
  apply = false,
  limit = QA_BACKFILL_DEFAULT_LIMIT,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  random = Math.random,
}) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > QA_BACKFILL_MAX_LIMIT) {
    throw new Error(`limit must be between 1 and ${QA_BACKFILL_MAX_LIMIT}`)
  }
  if (!client) throw new Error('Supabase client is required')
  if (apply && !apiKey) throw new Error('OPENAI_API_KEY is required for --apply')
  if (apply && typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')

  const selected = await selectBackfillCandidates(client, limit)
  const eligible = selected.filter(isEligibleChunk)
  const verified = eligible.filter((chunk) => sha256(chunk.body) === chunk.content_hash)
  let skipped = selected.length - verified.length
  let backfilled = 0

  if (apply && verified.length > 0) {
    const embeddings = []
    for (let offset = 0; offset < verified.length; offset += MAX_BATCH_SIZE) {
      const batch = verified.slice(offset, offset + MAX_BATCH_SIZE)
      embeddings.push(
        ...(await requestEmbeddingBatch({
          bodies: batch.map((chunk) => chunk.body),
          apiKey,
          fetchImpl,
          sleep,
          random,
        })),
      )
    }

    for (let index = 0; index < verified.length; index += 1) {
      const chunk = verified[index]
      const { error } = await client.rpc('qa_backfill_approved_chunk_embedding', {
        p_chunk_id: chunk.id,
        p_expected_content_hash: chunk.content_hash,
        p_embedding: JSON.stringify(embeddings[index]),
      })
      if (error && isSkippableRpcError(error)) {
        skipped += 1
        continue
      }
      if (error) throw new Error('Approved chunk embedding backfill failed')
      backfilled += 1
    }
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    verifiedCount: verified.length,
    backfilled,
    skipped,
    model: QA_BACKFILL_MODEL,
    dimension: QA_BACKFILL_DIMENSION,
    limit,
  }
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > QA_BACKFILL_MAX_LIMIT) {
    throw new Error(`${flag} requires an integer between 1 and ${QA_BACKFILL_MAX_LIMIT}`)
  }
  return value
}

export function parseBackfillArgs(argv) {
  const options = { apply: false, limit: QA_BACKFILL_DEFAULT_LIMIT }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--limit') options.limit = parsePositiveInteger(argv[++index], '--limit')
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseBackfillArgs(process.argv.slice(2))
  if (options.help) {
    console.log('node scripts/backfill_qa_embeddings.mjs [--limit N] [--apply]')
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const apiKey = options.apply ? process.env.OPENAI_API_KEY : undefined
  if (!supabaseUrl || !serviceRoleKey || (options.apply && !apiKey)) {
    throw new Error(
      options.apply
        ? 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY are required for --apply'
        : 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for dry-run inspection',
    )
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const summary = await backfillQaEmbeddings({ ...options, client, apiKey })
  console.log(JSON.stringify(summary))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

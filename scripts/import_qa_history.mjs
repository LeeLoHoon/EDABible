import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const FORMAT = 'edabible-qa-history-v1'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_FILE = '/tmp/opencode/EDABible-qna-import/qa-history.jsonl'
const apply = process.argv.includes('--apply')
const fileIndex = process.argv.indexOf('--file')
const inputPath = resolve(fileIndex >= 0 ? (process.argv[fileIndex + 1] ?? '') : DEFAULT_FILE)

if (process.argv.includes('--help')) {
  console.log('node scripts/import_qa_history.mjs [--file <jsonl>] [--apply]')
  process.exit(0)
}
if (fileIndex >= 0 && !process.argv[fileIndex + 1]) throw new Error('--file requires a path')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ raw: line.trim(), line: index + 1 }))
    .filter((item) => item.raw.length > 0)
    .map((item) => {
      try {
        return { ...item, value: JSON.parse(item.raw) }
      } catch (error) {
        throw new Error(`Invalid JSON on line ${item.line}`, { cause: error })
      }
    })
}

function assertText(value, name, line, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Invalid ${name} on line ${line}`)
  }
  return value.trim()
}

function validateSource(item) {
  const value = item.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Line ${item.line} must be an object`)
  }
  if (
    value.format !== FORMAT ||
    value.corpusVersion !== 'v1' ||
    value.embeddingModel !== EMBEDDING_MODEL
  ) {
    throw new Error(`Invalid format, corpusVersion, or embeddingModel on line ${item.line}`)
  }
  if (value.formatOnly === true) return null
  if (value.approved !== true) throw new Error(`Line ${item.line} is not an approved source`)

  const sourceTitle = assertText(value.sourceTitle, 'sourceTitle', item.line, 500)
  const publicUrl = value.publicUrl == null ? null : assertText(value.publicUrl, 'publicUrl', item.line, 2000)
  if (publicUrl && !publicUrl.startsWith('https://')) {
    throw new Error(`publicUrl must use https on line ${item.line}`)
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error(`Line ${item.line} must contain entries`)
  }

  const chunks = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid entry ${index} on line ${item.line}`)
    }
    const question = assertText(entry.question, `entries[${index}].question`, item.line, 4000)
    const answer = assertText(entry.answer, `entries[${index}].answer`, item.line, 7000)
    if (
      !Array.isArray(entry.embedding) ||
      entry.embedding.length !== 1536 ||
      !entry.embedding.every((number) => typeof number === 'number' && Number.isFinite(number))
    ) {
      throw new Error(`entries[${index}].embedding must contain 1536 finite numbers on line ${item.line}`)
    }
    const body = `Question: ${question}\nAnswer: ${answer}`
    return { body, contentHash: sha256(body), embedding: entry.embedding }
  })

  return {
    raw: item.raw,
    sourceTitle,
    publicUrl,
    sourceHash: sha256(item.raw),
    chunks,
  }
}

const input = await readFile(inputPath, 'utf8')
const parsed = parseJsonl(input)
const sources = parsed.map(validateSource).filter((source) => source !== null)
// Review-only fingerprint of this input batch. It is never persisted as corpus identity: v1 is
// the fixed retrieval contract, while each sourceHash drives incremental/idempotent imports.
const datasetHash = sha256(
  sources.map((source) => source.sourceHash).sort().join('\n'),
)

console.log(
  JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    inputPath,
    corpusVersion: 'v1',
    embeddingModel: EMBEDDING_MODEL,
    datasetHash,
    sourceCount: sources.length,
    chunkCount: sources.reduce((count, source) => count + source.chunks.length, 0),
    formatOnlyLines: parsed.length - sources.length,
  }),
)

if (!apply) {
  console.log('Dry-run only. Re-run with --apply after reviewing the counts and hashes.')
  process.exit(0)
}
if (sources.length === 0) throw new Error('No approved sources to import')

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply')
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
for (const source of sources) {
  const storagePath = `v1/sources/${source.sourceHash}.json`
  const directory = 'v1/sources'
  const fileName = `${source.sourceHash}.json`
  const { data: existing, error: listError } = await client.storage
    .from('qa-sources')
    .list(directory, { search: fileName, limit: 1 })
  if (listError) throw new Error('Private storage lookup failed', { cause: listError })

  if (!existing?.some((object) => object.name === fileName)) {
    const { error: uploadError } = await client.storage
      .from('qa-sources')
      .upload(storagePath, new Blob([source.raw], { type: 'application/json' }), {
        contentType: 'application/json',
        upsert: false,
      })
    if (uploadError) throw new Error('Private storage upload failed', { cause: uploadError })
  }

  const { error: importError } = await client.rpc('qa_import_approved_source', {
    p_title: source.sourceTitle,
    p_public_url: source.publicUrl,
    p_storage_path: storagePath,
    p_source_hash: source.sourceHash,
    p_embedding_model: EMBEDDING_MODEL,
    p_chunks: source.chunks,
  })
  if (importError) throw new Error('Approved source import failed', { cause: importError })
}

console.log(JSON.stringify({ applied: true, sourceCount: sources.length, datasetHash }))

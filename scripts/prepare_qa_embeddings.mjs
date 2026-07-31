import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const QA_HISTORY_FORMAT = 'edabible-qa-history-v1'
export const QA_EMBEDDING_MODEL = 'text-embedding-3-small'
export const QA_EMBEDDING_DIMENSION = 1536
export const QA_EMBEDDING_BATCH_SIZE = 64
export const QA_EMBEDDING_MAX_ATTEMPTS = 5

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)))
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

function isWithin(parent, child) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

export async function assertPathOutsideRepository(path, { output = false } = {}) {
  const resolvedPath = resolve(path)
  const canonicalRoot = await realpath(REPOSITORY_ROOT)
  const canonicalPath = output
    ? resolve(await realpath(dirname(resolvedPath)), basename(resolvedPath))
    : await realpath(resolvedPath)
  if (isWithin(canonicalRoot, resolvedPath) || isWithin(canonicalRoot, canonicalPath)) {
    throw new Error(`${output ? 'Output' : 'Input'} path must be outside the repository`)
  }
  return resolvedPath
}

function assertText(value, name, line, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Invalid ${name} on line ${line}`)
  }
  return value.trim()
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw.length > 0)
    .map(({ raw, line }) => {
      try {
        return { line, value: JSON.parse(raw) }
      } catch {
        throw new Error(`Invalid JSON on line ${line}`)
      }
    })
}

function validateSource({ line, value }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Line ${line} must be an object`)
  }
  if (
    value.format !== QA_HISTORY_FORMAT ||
    value.corpusVersion !== 'v1' ||
    value.embeddingModel !== QA_EMBEDDING_MODEL
  ) {
    throw new Error(`Invalid format, corpusVersion, or embeddingModel on line ${line}`)
  }
  if (value.formatOnly === true) return null
  if (value.approved !== true) throw new Error(`Line ${line} is not an approved source`)

  const sourceTitle = assertText(value.sourceTitle, 'sourceTitle', line, 500)
  const publicUrl =
    value.publicUrl == null ? null : assertText(value.publicUrl, 'publicUrl', line, 2000)
  if (publicUrl && !publicUrl.startsWith('https://')) {
    throw new Error(`publicUrl must use https on line ${line}`)
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error(`Line ${line} must contain entries`)
  }

  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid entry ${index} on line ${line}`)
    }
    if ('embedding' in entry) {
      throw new Error(`entries[${index}].embedding must be absent on line ${line}`)
    }
    const question = assertText(entry.question, `entries[${index}].question`, line, 4000)
    const answer = assertText(entry.answer, `entries[${index}].answer`, line, 7000)
    return {
      question,
      answer,
      body: `Question: ${question}\nAnswer: ${answer}`,
    }
  })

  return { sourceTitle, publicUrl, entries }
}

function validateEmbedding(value) {
  if (
    !Array.isArray(value) ||
    value.length !== QA_EMBEDDING_DIMENSION ||
    !value.every((number) => typeof number === 'number' && Number.isFinite(number))
  ) {
    throw new Error(`OpenAI embedding must contain ${QA_EMBEDDING_DIMENSION} finite numbers`)
  }
  return value
}

async function requestEmbeddingBatch({ bodies, apiKey, fetchImpl, sleep, random }) {
  for (let attempt = 1; attempt <= QA_EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: bodies,
        model: QA_EMBEDDING_MODEL,
        dimensions: QA_EMBEDDING_DIMENSION,
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
    if (attempt === QA_EMBEDDING_MAX_ATTEMPTS) {
      throw new Error(`OpenAI embeddings request failed after ${QA_EMBEDDING_MAX_ATTEMPTS} attempts`)
    }
    const delay = Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(random() * 100)
    await sleep(delay)
  }
  throw new Error('OpenAI embeddings retry state is invalid')
}

export async function prepareQaEmbeddingData({
  inputText,
  apply = false,
  limit = Number.POSITIVE_INFINITY,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  random = Math.random,
}) {
  if (!Number.isInteger(limit) && limit !== Number.POSITIVE_INFINITY) {
    throw new Error('limit must be a positive integer')
  }
  if (limit <= 0) throw new Error('limit must be a positive integer')
  if (apply && !apiKey) throw new Error('OPENAI_API_KEY is required for --apply')
  if (apply && typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')

  const parsed = parseJsonl(inputText)
  const validated = parsed.map(validateSource)
  let remaining = limit
  let skipped = validated.filter((source) => source === null).length
  const selectedSources = []
  for (const source of validated) {
    if (!source) continue
    const selectedEntries = source.entries.slice(0, remaining)
    skipped += source.entries.length - selectedEntries.length
    remaining -= selectedEntries.length
    if (selectedEntries.length > 0) selectedSources.push({ ...source, entries: selectedEntries })
  }

  const flattenedEntries = selectedSources.flatMap((source) => source.entries)
  if (!apply) {
    return {
      sourceCount: selectedSources.length,
      entryCount: flattenedEntries.length,
      skipped,
      outputText: null,
    }
  }
  if (flattenedEntries.length === 0) throw new Error('No approved Q&A entries to prepare')

  const embeddings = []
  for (let offset = 0; offset < flattenedEntries.length; offset += QA_EMBEDDING_BATCH_SIZE) {
    const batch = flattenedEntries.slice(offset, offset + QA_EMBEDDING_BATCH_SIZE)
    embeddings.push(
      ...(await requestEmbeddingBatch({
        bodies: batch.map((entry) => entry.body),
        apiKey,
        fetchImpl,
        sleep,
        random,
      })),
    )
  }

  let embeddingIndex = 0
  const outputText = `${selectedSources
    .map((source) =>
      JSON.stringify({
        format: QA_HISTORY_FORMAT,
        corpusVersion: 'v1',
        embeddingModel: QA_EMBEDDING_MODEL,
        approved: true,
        sourceTitle: source.sourceTitle,
        ...(source.publicUrl ? { publicUrl: source.publicUrl } : {}),
        entries: source.entries.map((entry) => ({
          question: entry.question,
          answer: entry.answer,
          embedding: embeddings[embeddingIndex++],
        })),
      }),
    )
    .join('\n')}\n`

  return {
    sourceCount: selectedSources.length,
    entryCount: flattenedEntries.length,
    skipped,
    outputText,
  }
}

export async function writeFileAtomically(outputPath, contents) {
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, outputPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export async function runPrepareQaEmbeddings({
  inputPath,
  outputPath,
  apply = false,
  limit = Number.POSITIVE_INFINITY,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep,
  random,
  readText = (path) => readFile(path, 'utf8'),
  writeOutput = writeFileAtomically,
}) {
  const safeInputPath = await assertPathOutsideRepository(inputPath)
  const safeOutputPath = await assertPathOutsideRepository(outputPath, { output: true })
  if (safeInputPath === safeOutputPath) throw new Error('Input and output paths must be different')

  const inputText = await readText(safeInputPath)
  const prepared = await prepareQaEmbeddingData({
    inputText,
    apply,
    limit,
    apiKey,
    fetchImpl,
    ...(sleep ? { sleep } : {}),
    ...(random ? { random } : {}),
  })
  if (apply && prepared.outputText !== null) await writeOutput(safeOutputPath, prepared.outputText)
  return {
    mode: apply ? 'apply' : 'dry-run',
    sourceCount: prepared.sourceCount,
    entryCount: prepared.entryCount,
    model: QA_EMBEDDING_MODEL,
    dimension: QA_EMBEDDING_DIMENSION,
    outPath: safeOutputPath,
    skipped: prepared.skipped,
  }
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} requires a positive integer`)
  return value
}

export function parsePrepareArgs(argv) {
  const options = { apply: false, limit: Number.POSITIVE_INFINITY }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--in') options.inputPath = argv[++index]
    else if (argument === '--out') options.outputPath = argv[++index]
    else if (argument === '--limit') options.limit = parsePositiveInteger(argv[++index], '--limit')
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (options.help) return options
  if (!options.inputPath) throw new Error('--in requires a path')
  if (!options.outputPath) throw new Error('--out requires a path')
  return options
}

async function main() {
  const options = parsePrepareArgs(process.argv.slice(2))
  if (options.help) {
    console.log('node scripts/prepare_qa_embeddings.mjs --in <path> --out <path> [--limit N] [--apply]')
    return
  }
  const apiKey = options.apply ? process.env.OPENAI_API_KEY : undefined
  const summary = await runPrepareQaEmbeddings({ ...options, apiKey })
  console.log(JSON.stringify(summary))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

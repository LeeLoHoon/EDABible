import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  QA_EMBEDDING_DIMENSION,
  QA_EMBEDDING_MAX_ATTEMPTS,
  prepareQaEmbeddingData,
  runPrepareQaEmbeddings,
} from './prepare_qa_embeddings.mjs'

const execFileAsync = promisify(execFile)
const knownQuestion = 'KNOWN_PRIVATE_QUESTION_TEXT'
const knownAnswer = 'KNOWN_PRIVATE_ANSWER_TEXT'
const vector = Array.from({ length: QA_EMBEDDING_DIMENSION }, (_, index) => index / 100000)

function source(entries = [{ question: `  ${knownQuestion}  `, answer: ` ${knownAnswer} ` }]) {
  return {
    format: 'edabible-qa-history-v1',
    corpusVersion: 'v1',
    embeddingModel: 'text-embedding-3-small',
    approved: true,
    sourceTitle: 'Approved archive',
    entries,
  }
}

function inputText(value = source()) {
  return `${JSON.stringify(value)}\n`
}

function successfulResponse(count = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector })),
    }),
  }
}

const cases = [
  {
    name: 'repository path rejection',
    run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'edabible-qa-prepare-path-'))
      try {
        await assert.rejects(
          runPrepareQaEmbeddings({
            inputPath: 'README.md',
            outputPath: join(directory, 'prepared.jsonl'),
          }),
          /outside the repository/,
        )
        await writeFile(join(directory, 'source.jsonl'), inputText())
        await assert.rejects(
          runPrepareQaEmbeddings({
            inputPath: join(directory, 'source.jsonl'),
            outputPath: 'data/prepared.jsonl',
          }),
          /outside the repository/,
        )
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  },
  {
    name: 'formatOnly skip',
    run: async () => {
      let fetchCalls = 0
      const result = await prepareQaEmbeddingData({
        inputText: inputText({
          format: 'edabible-qa-history-v1',
          corpusVersion: 'v1',
          embeddingModel: 'text-embedding-3-small',
          formatOnly: true,
        }),
        fetchImpl: async () => {
          fetchCalls += 1
          return successfulResponse()
        },
      })
      assert.equal(result.sourceCount, 0)
      assert.equal(result.entryCount, 0)
      assert.equal(result.skipped, 1)
      assert.equal(fetchCalls, 0)
    },
  },
  {
    name: 'dry-run zero fetch and zero write',
    run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'edabible-qa-prepare-dry-'))
      const sourcePath = join(directory, 'source.jsonl')
      const outputPath = join(directory, 'prepared.jsonl')
      let fetchCalls = 0
      let writeCalls = 0
      try {
        await writeFile(sourcePath, inputText())
        const summary = await runPrepareQaEmbeddings({
          inputPath: sourcePath,
          outputPath,
          fetchImpl: async () => {
            fetchCalls += 1
            return successfulResponse()
          },
          writeOutput: async () => {
            writeCalls += 1
          },
        })
        assert.equal(summary.mode, 'dry-run')
        assert.equal(summary.entryCount, 1)
        assert.equal(fetchCalls, 0)
        assert.equal(writeCalls, 0)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  },
  {
    name: 'successful mocked 1536-vector output is accepted by importer contract',
    run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'edabible-qa-prepare-apply-'))
      const sourcePath = join(directory, 'source.jsonl')
      const outputPath = join(directory, 'prepared.jsonl')
      try {
        await writeFile(sourcePath, inputText())
        const summary = await runPrepareQaEmbeddings({
          inputPath: sourcePath,
          outputPath,
          apply: true,
          apiKey: 'test-key-not-logged',
          fetchImpl: async (_url, options) => {
            const request = JSON.parse(options.body)
            assert.deepEqual(request.input, [`Question: ${knownQuestion}\nAnswer: ${knownAnswer}`])
            assert.equal(request.model, 'text-embedding-3-small')
            assert.equal(request.dimensions, 1536)
            return successfulResponse()
          },
        })
        assert.equal(summary.entryCount, 1)
        const prepared = JSON.parse((await readFile(outputPath, 'utf8')).trim())
        assert.equal(prepared.entries[0].embedding.length, 1536)
        assert.equal(prepared.entries[0].question, knownQuestion)
        const { stdout } = await execFileAsync(process.execPath, [
          'scripts/import_qa_history.mjs',
          '--file',
          outputPath,
        ])
        const importSummary = JSON.parse(stdout.split('\n')[0])
        assert.equal(importSummary.sourceCount, 1)
        assert.equal(importSummary.chunkCount, 1)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  },
  {
    name: '429 retry and bounded failure',
    run: async () => {
      let retryCalls = 0
      let sleeps = 0
      const retried = await prepareQaEmbeddingData({
        inputText: inputText(),
        apply: true,
        apiKey: 'test-key-not-logged',
        fetchImpl: async () => {
          retryCalls += 1
          return retryCalls === 1 ? { ok: false, status: 429 } : successfulResponse()
        },
        sleep: async () => {
          sleeps += 1
        },
        random: () => 0,
      })
      assert.equal(retried.entryCount, 1)
      assert.equal(retryCalls, 2)
      assert.equal(sleeps, 1)

      let failureCalls = 0
      await assert.rejects(
        prepareQaEmbeddingData({
          inputText: inputText(),
          apply: true,
          apiKey: 'test-key-not-logged',
          fetchImpl: async () => {
            failureCalls += 1
            return { ok: false, status: 429 }
          },
          sleep: async () => undefined,
          random: () => 0,
        }),
        new RegExp(`after ${QA_EMBEDDING_MAX_ATTEMPTS} attempts`),
      )
      assert.equal(failureCalls, QA_EMBEDDING_MAX_ATTEMPTS)
    },
  },
  {
    name: 'stdout summary excludes known source text',
    run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'edabible-qa-prepare-summary-'))
      const sourcePath = join(directory, 'source.jsonl')
      try {
        await writeFile(sourcePath, inputText())
        const summary = await runPrepareQaEmbeddings({
          inputPath: sourcePath,
          outputPath: join(directory, 'prepared.jsonl'),
        })
        const stdout = JSON.stringify(summary)
        assert.equal(stdout.includes(knownQuestion), false)
        assert.equal(stdout.includes(knownAnswer), false)
        assert.equal(stdout.includes('Approved archive'), false)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  },
]

for (const entry of cases) test(`Q&A preparation: ${entry.name}`, entry.run)

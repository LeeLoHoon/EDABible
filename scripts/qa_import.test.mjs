import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)

test('Q&A import dry-run은 fixed embedding model provenance를 보고한다', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/import_qa_history.mjs',
    '--file',
    'data/qa-history.example.jsonl',
  ])
  const summary = JSON.parse(stdout.split('\n')[0])
  assert.equal(summary.embeddingModel, 'text-embedding-3-small')
  assert.equal(summary.sourceCount, 0)
})

test('Q&A import는 다른 embedding model metadata를 거부한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'edabible-qa-import-test-'))
  const path = join(directory, 'invalid.jsonl')
  await writeFile(
    path,
    `${JSON.stringify({
      format: 'edabible-qa-history-v1',
      corpusVersion: 'v1',
      embeddingModel: 'other-model',
      formatOnly: true,
    })}\n`,
  )
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/import_qa_history.mjs', '--file', path]),
      /embeddingModel/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

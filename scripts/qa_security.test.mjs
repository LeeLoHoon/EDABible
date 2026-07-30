import assert from 'node:assert/strict'
import test from 'node:test'
import { runQaSecurityChecks } from './check_qa_security.mjs'

test('Q&A schema, Edge Function, client secret boundaries pass static checks', async () => {
  assert.deepEqual(await runQaSecurityChecks(), [])
})

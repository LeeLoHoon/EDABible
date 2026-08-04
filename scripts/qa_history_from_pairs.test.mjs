import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  normalizePairs,
  parseArgs,
  readPairs,
  scanPii,
  topLevelKeys,
} from './build_qa_history_from_pairs.mjs'

test('Q&A pairs: 중복 질문 키를 찾아낸다', () => {
  const text = '{"질문A":"답1","질문B":"답2","질문A":"답3"}'
  assert.deepEqual(topLevelKeys(text), ['질문A', '질문B', '질문A'])

  const { pairs, notes } = readPairs(text)
  assert.equal(pairs.length, 2)
  assert.ok(notes.some((note) => note.includes('중복')))
})

test('Q&A pairs: 답변 안의 중괄호나 콜론을 키로 오인하지 않는다', () => {
  const text = '{"질문":"답변에 {중괄호}와 \\"따옴표\\": 콜론이 있습니다"}'
  assert.deepEqual(topLevelKeys(text), ['질문'])
})

test('Q&A pairs: 객체·배열·JSONL 입력을 모두 받는다', () => {
  const cases = [
    { name: 'object', text: '{"질문":"답변"}' },
    { name: 'array', text: '[{"question":"질문","answer":"답변"}]' },
    { name: 'jsonl', text: '{"question":"질문","answer":"답변"}' },
  ]
  for (const { name, text } of cases) {
    const { pairs } = readPairs(text)
    assert.equal(pairs.length, 1, name)
    assert.equal(pairs[0].question, '질문', name)
    assert.equal(pairs[0].answer, '답변', name)
  }
})

test('Q&A pairs: 빈 값과 길이 초과를 제외한다', () => {
  const { entries, skipped } = normalizePairs([
    { question: '  정상 질문  ', answer: '  정상 답변  ' },
    { question: '빈 답변', answer: '   ' },
    { question: '긴 질문', answer: 'a'.repeat(7001) },
    { question: 'q'.repeat(4001), answer: '답변' },
  ])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].question, '정상 질문')
  assert.equal(entries[0].answer, '정상 답변')
  assert.equal(skipped.length, 3)
})

test('Q&A pairs: 식별 가능한 표현을 찾고 일반 표현은 넘긴다', () => {
  const hits = scanPii([
    { question: '김철수 집사님이 010-1234-5678로 문의했습니다', answer: '답변' },
    { question: '목사님께 여쭙습니다', answer: '우리 교회 성도 여러분께' },
    { question: '연락처는 test@example.com 입니다', answer: '답변' },
  ])
  const kinds = hits.map((hit) => hit.kind)
  assert.ok(kinds.includes('이름+직분'))
  assert.ok(kinds.includes('전화번호'))
  assert.ok(kinds.includes('이메일'))
  // "목사님께", "우리 교회 성도" 같은 일반 표현만 있는 항목은 걸리지 않는다
  assert.ok(!hits.some((hit) => hit.index === 1))
})

test('Q&A pairs: 필수 인자와 https 출처를 검증한다', () => {
  assert.throws(() => parseArgs(['--in', 'a']), /--out/)
  assert.throws(() => parseArgs(['--in', 'a', '--out', 'b']), /--title/)
  assert.throws(
    () => parseArgs(['--in', 'a', '--out', 'b', '--title', 't', '--url', 'http://x']),
    /https/,
  )

  const options = parseArgs(['--in', 'a', '--out', 'b', '--title', 't'])
  assert.equal(options.apply, false)
  assert.equal(options.approved, false)
  assert.equal(options.publicUrl, null)
})

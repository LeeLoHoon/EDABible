// 목사님 질의응답 원본({"질문": "답변", ...} 등)을 prepare_qa_embeddings 입력 계약으로 바꾼다.
// 기본은 dry-run이며 --apply에서만 파일을 쓴다. 승인 표시는 --approved로 사람이 명시해야 한다.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { assertPathOutsideRepository, QA_EMBEDDING_MODEL, QA_HISTORY_FORMAT } from './prepare_qa_embeddings.mjs'

const QUESTION_MAX = 4000
const ANSWER_MAX = 7000

// 흔한 성씨 뒤에 직분이 붙는 형태만 잡아 "우리 목사님" 같은 일반 표현의 오탐을 줄인다.
const SURNAMES =
  '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모남궁'
const PII_PATTERNS = [
  { name: '이름+직분', regex: new RegExp(`[${SURNAMES}][가-힣]{1,2}\\s*(집사|권사|장로|목사|전도사|사모|성도|선생)`, 'g') },
  { name: '전화번호', regex: /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g },
  { name: '이메일', regex: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { name: '주민번호형', regex: /\d{6}[-\s]?[1-4]\d{6}/g },
]

/** 최상위 객체의 키를 등장 순서대로 모은다. JSON.parse가 조용히 덮어쓰는 중복 키를 찾기 위함이다. */
export function topLevelKeys(text) {
  const keys = []
  let index = 0
  let depth = 0
  let expectKey = false

  while (index < text.length) {
    const char = text[index]

    if (char === '"') {
      let cursor = index + 1
      while (cursor < text.length) {
        if (text[cursor] === '\\') { cursor += 2; continue }
        if (text[cursor] === '"') break
        cursor += 1
      }
      if (depth === 1 && expectKey) {
        try {
          keys.push(JSON.parse(text.slice(index, cursor + 1)))
        } catch {
          // 키로 읽히지 않으면 중복 검사 대상에서 제외한다
        }
        expectKey = false
      }
      index = cursor + 1
      continue
    }

    if (char === '{' || char === '[') {
      depth += 1
      if (char === '{' && depth === 1) expectKey = true
      index += 1
      continue
    }
    if (char === '}' || char === ']') { depth -= 1; index += 1; continue }
    if (char === ',' && depth === 1) { expectKey = true; index += 1; continue }
    if (char === ':') { expectKey = false; index += 1; continue }
    index += 1
  }
  return keys
}

/** {질문: 답변} 객체 · [{question, answer}] 배열 · JSONL을 모두 받아 공통 쌍 목록으로 만든다. */
export function readPairs(text) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Input file is empty')

  const notes = []
  let pairs = []

  if (trimmed.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // 객체 하나가 아니면 JSONL로 다시 시도한다
      return readJsonl(trimmed, notes)
    }
    const parsedKeys = Object.keys(parsed)
    // 한 줄짜리 JSONL({"question":..,"answer":..})은 {질문: 답변} 객체와 모양이 겹친다.
    if (typeof parsed?.question === 'string' && typeof parsed?.answer === 'string') {
      return readJsonl(trimmed, notes)
    }

    const keys = topLevelKeys(trimmed)
    if (keys.length > parsedKeys.length) {
      notes.push(
        `원본 키 ${keys.length}개 중 ${keys.length - parsedKeys.length}개가 중복 질문이라 사라졌습니다 ` +
          '(JSON 객체는 같은 키를 남기지 못합니다). 질문 문구를 구분하거나 배열/JSONL 형식으로 주세요.',
      )
      const seen = new Set()
      for (const key of keys) {
        if (seen.has(key)) notes.push(`  중복된 질문: ${key.slice(0, 60)}`)
        seen.add(key)
      }
    }
    pairs = parsedKeys.map((question) => ({ question, answer: parsed[question] }))
    return { pairs, notes }
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) throw new Error('Input must be an object, array, or JSONL')
    pairs = parsed.map((entry) => ({ question: entry?.question, answer: entry?.answer }))
    return { pairs, notes }
  }

  return readJsonl(trimmed, notes)
}

function readJsonl(text, notes) {
  const pairs = text
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, raw: line.trim() }))
    .filter(({ raw }) => raw.length > 0)
    .map(({ line, raw }) => {
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        throw new Error(`Invalid JSON on line ${line}`)
      }
      return { question: value?.question, answer: value?.answer }
    })
  return { pairs, notes }
}

export function normalizePairs(pairs) {
  const entries = []
  const skipped = []

  pairs.forEach((pair, index) => {
    const question = typeof pair.question === 'string' ? pair.question.trim() : ''
    const answer = typeof pair.answer === 'string' ? pair.answer.trim() : ''
    if (!question || !answer) {
      skipped.push({ index, reason: '질문 또는 답변이 비어 있음', question: question.slice(0, 40) })
      return
    }
    if (question.length > QUESTION_MAX) {
      skipped.push({ index, reason: `질문이 ${QUESTION_MAX}자를 넘음 (${question.length}자)`, question: question.slice(0, 40) })
      return
    }
    if (answer.length > ANSWER_MAX) {
      skipped.push({ index, reason: `답변이 ${ANSWER_MAX}자를 넘음 (${answer.length}자)`, question: question.slice(0, 40) })
      return
    }
    entries.push({ question, answer })
  })

  return { entries, skipped }
}

/** 승인 corpus는 인용문으로 성도에게 노출되므로 식별 가능한 표현을 미리 훑는다. */
export function scanPii(entries) {
  const hits = []
  entries.forEach((entry, index) => {
    for (const field of ['question', 'answer']) {
      for (const pattern of PII_PATTERNS) {
        const matches = entry[field].match(pattern.regex)
        if (matches) {
          hits.push({
            index,
            field: field === 'question' ? '질문' : '답변',
            kind: pattern.name,
            samples: [...new Set(matches)].slice(0, 5),
            preview: entry.question.slice(0, 50),
          })
        }
      }
    }
  })
  return hits
}

export function parseArgs(argv) {
  const options = { apply: false, approved: false, publicUrl: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--apply') options.apply = true
    else if (argument === '--approved') options.approved = true
    else if (argument === '--in') options.inputPath = argv[++index]
    else if (argument === '--out') options.outputPath = argv[++index]
    else if (argument === '--title') options.title = argv[++index]
    else if (argument === '--url') options.publicUrl = argv[++index]
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (options.help) return options
  if (!options.inputPath) throw new Error('--in requires a path')
  if (!options.outputPath) throw new Error('--out requires a path')
  if (!options.title) throw new Error('--title requires the source title shown to readers')
  if (options.publicUrl && !options.publicUrl.startsWith('https://')) {
    throw new Error('--url must start with https://')
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      'node scripts/build_qa_history_from_pairs.mjs --in <path> --out <path> --title <제목> [--url https://...] [--approved] [--apply]',
    )
    return
  }

  const inputPath = await assertPathOutsideRepository(options.inputPath)
  const outputPath = await assertPathOutsideRepository(options.outputPath, { output: true })

  const { pairs, notes } = readPairs(await readFile(inputPath, 'utf8'))
  const { entries, skipped } = normalizePairs(pairs)
  const pii = scanPii(entries)

  console.log(`입력 항목: ${pairs.length}개 → 변환 가능: ${entries.length}개`)
  for (const note of notes) console.log(`⚠ ${note}`)
  if (skipped.length > 0) {
    console.log(`\n제외된 항목 ${skipped.length}개:`)
    for (const item of skipped) console.log(`  [${item.index}] ${item.reason} — ${item.question}`)
  }

  if (pii.length > 0) {
    console.log(`\n⚠ 개인정보 의심 표현 ${pii.length}건 — 질문 원문 앞 600자는 인용문으로 공개됩니다:`)
    for (const hit of pii) {
      console.log(`  [${hit.index}] ${hit.field}/${hit.kind}: ${hit.samples.join(', ')}  ← ${hit.preview}`)
    }
    console.log('  (오탐이 섞일 수 있습니다. 원본을 고친 뒤 다시 실행하세요.)')
  } else {
    console.log('\n개인정보 의심 표현: 없음')
  }

  if (entries.length === 0) throw new Error('변환할 항목이 없습니다')

  const source = {
    format: QA_HISTORY_FORMAT,
    corpusVersion: 'v1',
    embeddingModel: QA_EMBEDDING_MODEL,
    approved: options.approved,
    sourceTitle: options.title,
    publicUrl: options.publicUrl,
    entries,
  }

  if (!options.approved) {
    console.log('\n⚠ --approved가 없어 approved:false로 표시됩니다. 이 파일은 import에서 거부됩니다.')
  }

  if (!options.apply) {
    console.log('\ndry-run — 파일을 쓰지 않았습니다. 확인 후 --apply를 붙이세요.')
    return
  }

  const temporaryPath = resolve(dirname(outputPath), `.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify(source)}\n`, 'utf8')
  await rename(temporaryPath, outputPath)
  console.log(`\n작성 완료: ${outputPath} (entries ${entries.length}개, approved=${options.approved})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

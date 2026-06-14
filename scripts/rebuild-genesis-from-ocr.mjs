import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sourceDir = '/home/easy/bible/work/txt/etc';
const outPath = 'reports/ocr-rebuild/01_창.ocr-draft.json';
const reportPath = 'reports/ocr-rebuild/01_창.ocr-report.json';

const book = {
  order: 1,
  book: '창세기',
  abbr: '창',
};

const pageRange = [47, 163];

const chapterAnchors = [
  [1, '모든 것의 시작은 이러하다'],
  [2, '하늘과 땅의 모든 것이'],
  [3, '뱀은 하나님께서 지으신 들짐승 가운데'],
  [4, '아담이 자기 아내 하와와 잠자리를 같이하니'],
  [5, '인류의 족보는 이러하다'],
  [6, '사람들의 수가 늘어나기 시작하고'],
  [7, '그 후에 하나님께서 노아에게 말씀하셨다'],
  [8, '그때에 하나님께서 노아와'],
  [9, '하나님께서 노아와 그의 아들들에게 복을 주시며'],
  [10, '노아의 세 아들, 셈과 함과 야벳의 족보는 이러하다'],
  [11, '한때 온 세상이 같은 언어를 사용했다'],
  [12, '하나님께서{아브람튀게 말씀하셨다'],
  [13, '아브람은 아내와 자신의 모든 소유를 가지고 이집트를 떠나'],
  [14, '그때에 이런 일이 있었다'],
  [15, '이 모든 일이 있은 뒤에'],
  [16, '아브람의 아내 사래는 아직 아이를 낳지 못했다'],
  [17, '아브람이 아흔아홈 살이 되었을 때'],
  [18, '하나님께서 마므레의 상수리나무 숲 근처에서 아브라함에'],
  [19, '저녁때에 두 천사가 소돔에 도착했다'],
  [20, '아브라함은 그곳에서 님쪽 네 지역으로 이주히여'],
  [21, '하나님께서는 약속하신 바로 그날에 사라를 찾아오셨다'],
  [22, '이 모든 일이 있은 뒤에, 하나님께서 아브라함을 시험하셨'],
  [23, '사라는 127년을 살았다'],
  [24, '아브라함은 이제 노인이 되었다'],
  [25, '아브라함이 재혼을 했다'],
  [26, '그 땅에 흠년이 들었다'],
  [27, '이삭이 너서 거의 앞을 볼 수 없게 되자'],
  [28, '이삭은 야곱을 불러 축복한 다음'],
  [29, '야곱이 다시 길을 떠나 동방 사람들의 땅에 이르렀다'],
  [30, '라헬은 자신이 야곱의 아이를 낳지 못함을 깨닫고'],
  [31, '야콤은 라반의 아들들이 뒤에서 쑥덕거리는 소리를 들었다'],
  [32, '야곱도 자기 길을 갔다'],
  [33, '야곱이 눈을 들어 보니, 에서가'],
  [34, '어느 날, 레아가 낳은 야곱의 딸 디나가'],
  [35, '베텔로 톨아가거라'],
  [36, '에돔이라고도 하는 에서의 족보는 이러하다'],
  [37, '요셈과 그의 형제들'],
  [38, '그 무렵, 유다는 형제들로부터 떨어져 나와'],
  [39, '이스마엘 사람들이 요셉을 이집트로 끌고 가자'],
  [40, '시간이 훌러'],
  [41, '그로부터 두 해가 지난 뒤에 바로가 꿈을 꾸었다'],
  [42, '야곱이 이집트에 식량이 있다는 소문을 듣고'],
  [43, '기근이 더욱 심해졌다'],
  [44, '요셉이 자기 집 관리인에게 지시했다'],
  [45, '요셉은 더 이상 자신을 억제할 수 없어'],
  [46, '마침내 이스라엘은 자기의 모든 소유를 가지고 여행길에 올'],
  [47, '요셉이 바로에게 가서 말했다'],
  [48, '이런 대화가 있고 나서 얼마 후에'],
  [49, '야곱이 아들들을 불러 말했다'],
  [50, '요셉이 아버지를 끌어안고 슬피 울며'],
];

const headingLines = new Set([
  '하늘과 땅의 창조',
  '사람의 불순종',
  '가인과 아벨',
  '인류의 족보',
  '땅의 거인들',
  '홍수가 땅을 덮다',
  '노아가 하나님께 제단을 쌓다',
  '내가 너희와 언약을 맺겠다',
  '노아 자손의 족보',
  '하나님께서 사람들의 언어를 혼란스럽게 하시다',
  '아브람과 롯이 갈라지다',
  '멜기세덱의 축복몰 받다 .',
  '하나님께서 아브람과 언약을 맺으시다',
  '하갈과 이스마엘',
  '하갈과 이스마엘 :',
  '할레, 언약의 표',
  '하나님께서 아브라함에게 아들을 약속하시다',
  '아브라함이 소돔음 위해 간구하다',
  '소돕과 고모라의 심판',
  '아브라함과 아비멜렉',
  '이삭이 태어나다',
  '브엘세바에서 아비멜렉과 맺은 계약',
  '하나님께서 야브라함음 시험하시다',
  '베델에서 드린 야곱의 서원',
  '막벨라 동굴에 사라름 묻다',
  '이삭과 리브가',
  '아브라함이 죽다',
  '이삭이 야곰을 축복하다',
  '야곱이 라반의 집에 머물다',
  '야곱이 라반을 떠나 고향으로 돌아가다',
  '야곰과 에서의 화해',
  '디나가 부끄러운 임을 당하다',
  '베텔로 톨아가거라',
  "베텔로 톨아가거라 '",
  '에서의 족보',
  '요셈과 그의 형제들',
  '유다와 다말',
  '이집트로 팔려 간 요셉',
  '관리들의 꿈을 해석하다',
  '바로의 꿈을 해석하다',
  '요셉의 형듭이 식량을 구하러 이집트로 가다',
  '베냐민을 데리고 다시 이집트로 가다',
  '베냐민의 자루에서 은잔이 나오다',
  '야곱의 가족이 이집트로 가다',
  '에브라임과 므낮세롭 축복하다',
  '야곱이 열두 아들을 축복하다',
  '야곰의 죽음',
]);

const readSource = () => {
  const chunks = [];
  for (let n = pageRange[0]; n <= pageRange[1]; n += 1) {
    const name = `e-${String(n).padStart(4, '0')}.txt`;
    const raw = readFileSync(join(sourceDir, name), 'utf8');
    const lines = raw.split(/\r?\n/).filter((line) => !isDiscardLine(line));
    chunks.push(lines.join('\n'));
  }
  return chunks.join('\n');
};

const isDiscardLine = (line) => {
  const text = line.trim();
  if (!text) return false;
  if (/^[^가-힣A-Za-z]{0,6}\d{1,4}\s+(?:창세기|참세기)\s*[\d\- ]*$/.test(text)) return true;
  if (/^.{0,4}(?:창세기|참세기)\s*[\d\- ]+$/.test(text)) return true;
  if (/^(?:창세기|참세기)(?:\s*[\d\- ]+)?$/.test(text)) return true;
  if (/^\d{1,4}$/.test(text)) return true;
  if (/^[\d\s\-<>()|[\]{}'".,:;`~!?]+$/.test(text)) return true;
  return false;
};

const normalizeLine = (line) =>
  line
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

const removeLeadingMarker = (line) =>
  line
    .replace(/^[^가-힣A-Za-z"“'‘]{0,12}(?:\d{1,3}\s*){1,3}[^가-힣A-Za-z"“'‘]{0,12}/, '')
    .replace(/^[^가-힣A-Za-z"“'‘]+/, '')
    .trim();

const cleanSegment = (segment, anchor) => {
  const offset = segment.indexOf(anchor);
  const trimmed = offset >= 0 ? segment.slice(offset) : segment;
  const paragraphs = [];
  let current = [];

  for (const rawLine of trimmed.split('\n')) {
    let line = normalizeLine(rawLine);
    if (!line) {
      flush();
      continue;
    }
    if (headingLines.has(line)) continue;
    if (/^[가-힣]\s*\d+\s*\|$/.test(line)) continue;
    line = removeLeadingMarker(line);
    if (!line || headingLines.has(line)) continue;
    if (/^[가-힣A-Za-z]{1,3}$/.test(line)) continue;
    current.push(line);
  }
  flush();

  return paragraphs
    .join('\n\n')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  function flush() {
    if (current.length === 0) return;
    paragraphs.push(current.join(' '));
    current = [];
  }
};

const source = readSource();
const starts = chapterAnchors.map(([chapter, anchor]) => ({
  chapter,
  anchor,
  offset: source.indexOf(anchor),
}));

const missing = starts.filter((entry) => entry.offset < 0);
const nonMonotonic = starts
  .slice(1)
  .filter((entry, idx) => starts[idx].offset >= 0 && entry.offset >= 0 && entry.offset <= starts[idx].offset);

if (missing.length > 0 || nonMonotonic.length > 0) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({ ok: false, missing, nonMonotonic, starts }, null, 2) + '\n',
  );
  console.error('Genesis OCR rebuild failed. See', reportPath);
  process.exit(1);
}

const chapters = starts.map((entry, idx) => {
  const next = starts[idx + 1]?.offset ?? source.length;
  return {
    chapter: entry.chapter,
    text: cleanSegment(source.slice(entry.offset, next), entry.anchor),
  };
});

const shortChapters = chapters.filter((chapter) => chapter.text.length < 120);
const leadingHeadings = chapters.filter((chapter) => headingLines.has(chapter.text.split('\n', 1)[0]?.trim() ?? ''));
const residualHeaders = chapters
  .map((chapter) => ({
    chapter: chapter.chapter,
    matches: [...chapter.text.matchAll(/.{0,30}(?:창세기|참세기).{0,30}/g)].map((match) => match[0]),
  }))
  .filter((entry) => entry.matches.length > 0);
const doc = { ...book, chapters };
const report = {
  ok: shortChapters.length === 0 && leadingHeadings.length === 0 && residualHeaders.length === 0,
  sourceDir,
  pageRange,
  chapterCount: chapters.length,
  shortChapters: shortChapters.map(({ chapter, text }) => ({ chapter, length: text.length, text })),
  leadingHeadings: leadingHeadings.map(({ chapter }) => chapter),
  residualHeaders,
  starts,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(doc, null, 1) + '\n');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');

if (!report.ok) {
  console.error('Genesis OCR rebuild produced QA warnings. See', reportPath);
  process.exit(1);
}

console.log(`Wrote ${outPath}`);
console.log(`Wrote ${reportPath}`);

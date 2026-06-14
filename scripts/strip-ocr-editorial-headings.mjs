import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const sourceDir = '/home/easy/bible/work/txt/etc';
const bibleDir = 'public/bible';
const reportPath = 'reports/ocr-heading-strip.json';

const shortAllowed = new Set([
  '남자',
  '여자',
  '친구들',
  '신부',
  '신랑',
]);

const manualHeadings = new Set([
  '사람의 불순종',
  '하나님께서 아브람과 언약을 맺으시다',
  '하갈과 이스마엘',
  '하나님께서 아브라함에게 아들을 약속하시다',
  '소돔과 고모라의 심판',
]);

const index = JSON.parse(readFileSync(join(bibleDir, 'index.json'), 'utf8'));

const normalize = (value) => value.replace(/\s+/g, ' ').trim();

const isLikelyHeading = (value) => {
  const text = normalize(value);
  if (!text) return false;
  if (manualHeadings.has(text)) return true;
  if (shortAllowed.has(text)) return true;
  if (text.length < 4) return false;
  if (text.length > 42) return false;
  if (!/[가-힣]/.test(text)) return false;
  if (/^\d/.test(text)) return false;
  if (/[.!?。"'“”():：]/.test(text)) return false;
  if (/^(창세기|참세기|출애굽기|레위기|민수기|신명기|시편|마태복음)$/.test(text)) return false;
  return true;
};

const lineLooksLikeChapterStart = (line) =>
  /^[^가-힣A-Za-z]{0,12}(?:\d\s*){1,3}[^가-힣A-Za-z]{0,12}[가-힣]/.test(normalize(line));

const collectHeadings = () => {
  const headings = new Set(manualHeadings);
  for (const name of readdirSync(sourceDir).filter((entry) => /^e-\d+\.txt$/.test(entry)).sort()) {
    const lines = readFileSync(join(sourceDir, name), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i += 1) {
      const heading = normalize(lines[i]);
      if (isLikelyHeading(heading) && lineLooksLikeChapterStart(lines[i + 1])) {
        headings.add(heading);
      }
    }
  }
  return [...headings].sort((a, b) => b.length - a.length || a.localeCompare(b, 'ko'));
};

const stripHeadingPrefix = (text, headings) => {
  const normalized = normalize(text);
  for (const heading of headings) {
    if (normalized === heading) {
      return { text, heading: null };
    }
    if (normalized.startsWith(`${heading} `)) {
      const next = normalized
        .slice(heading.length)
        .trimStart()
        .replace(/^\(?\d{1,3}(?:-\d{1,3})?\)?\s*/, '')
        .trimStart();
      if (!next) {
        return { text, heading: null };
      }
      return {
        text: next,
        heading,
      };
    }
  }
  return { text, heading: null };
};

const stripLeadingVerseMarker = (text) => {
  const normalized = normalize(text);
  const next = normalized
    .replace(/^\(?\d{1,3}(?:-\d{1,3})?\)?\s+/, '')
    .replace(/^[가-힣]\s+\d{1,3}\s+/, '')
    .trimStart();
  return next || text;
};

const headings = collectHeadings();
const changes = [];

for (const entry of index) {
  const filePath = join(bibleDir, entry.file);
  const doc = JSON.parse(readFileSync(filePath, 'utf8'));
  let changed = false;

  for (const chapter of doc.chapters) {
    const before = chapter.text;
    const stripped = stripHeadingPrefix(before, headings);
    const withoutMarker = stripLeadingVerseMarker(stripped.text);
    if (!stripped.heading && withoutMarker === before) continue;

    chapter.text = withoutMarker;
    changed = true;
    changes.push({
      book: entry.book,
      file: entry.file,
      chapter: chapter.chapter,
      heading: stripped.heading,
      markerStripped: withoutMarker !== stripped.text,
      before: normalize(before).slice(0, 160),
      after: normalize(chapter.text).slice(0, 160),
    });
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(doc, null, 1) + '\n');
  }
}

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      sourceDir,
      headingCount: headings.length,
      changedCount: changes.length,
      changes,
    },
    null,
    2,
  ) + '\n',
);

console.log(`Detected ${headings.length} heading candidates.`);
console.log(`Stripped ${changes.length} chapter prefixes.`);
console.log(`Wrote ${reportPath}`);

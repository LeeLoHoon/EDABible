import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const bibleDir = new URL('../public/bible/', import.meta.url);
const reportPath = new URL('../.tmp/bible-validation.json', import.meta.url);

const index = JSON.parse(readFileSync(new URL('index.json', bibleDir), 'utf8'));
const files = readdirSync(bibleDir).filter((name) => name.endsWith('.json') && name !== 'index.json');

const fileSet = new Set(files);
const issues = [];

const leadingVerse = /^\s*\(?\d{1,3}(?:-\d{1,3})?\)?(?:\s|$)/;
const boxNoteHeading = /^\s*\([^)]*\d{1,3}:\d{1,3}(?:-\d{1,3})?[^)]*\)/;
const residualPageHeader = /(?:^|\n)\s*.{0,4}(?:창세기|참세기|출애굽기|레위기|민수기|신명기)\s+\d[\d\- ]*(?:\n|$)/;
const editorialHeadings = new Set([
  '하늘과 땅의 창조',
  '사람의 불순종',
  '가인과 아벨',
  '인류의 족보',
  '홍수가 땅을 덮다',
  '하나님께서 아브람을 부르시다',
  '하나님께서 아브람과 언약을 맺으시다',
  '소돔과 고모라의 심판',
  '솔로몬이 왕이 되다',
  '유다 왕 므낫세',
  '유다 왕 요시야',
  '심판의 메시지',
  '떨감으로나 쓰일 예루살렘',
  '넷째 환상: 하나님의 천사 앞에 선 여호수아',
]);

for (const entry of index) {
  if (!fileSet.has(entry.file)) {
    issues.push({
      type: 'missing-file',
      book: entry.book,
      file: entry.file,
    });
    continue;
  }

  const doc = JSON.parse(readFileSync(new URL(entry.file, bibleDir), 'utf8'));
  const chapters = Array.isArray(doc.chapters) ? doc.chapters : [];

  if (chapters.length !== entry.standardChapters) {
    issues.push({
      type: 'chapter-count',
      book: entry.book,
      file: entry.file,
      actual: chapters.length,
      expected: entry.standardChapters,
    });
  }

  if (typeof entry.chapters === 'number' && entry.chapters !== chapters.length) {
    issues.push({
      type: 'index-chapter-count',
      book: entry.book,
      file: entry.file,
      actual: entry.chapters,
      expected: chapters.length,
    });
  }

  const chapterNumbers = chapters.map((chapter) => chapter.chapter);
  for (let i = 1; i <= entry.standardChapters; i += 1) {
    if (chapterNumbers[i - 1] !== i) {
      issues.push({
        type: 'chapter-sequence',
        book: entry.book,
        file: entry.file,
        expectedAt: i,
        actualAt: chapterNumbers[i - 1] ?? null,
      });
      break;
    }
  }

  for (const chapter of chapters) {
    const text = typeof chapter.text === 'string' ? chapter.text : '';
    const firstLine = text.trim().split('\n', 1)[0]?.trim() ?? '';
    if (!firstLine) {
      issues.push({
        type: 'empty-chapter',
        book: entry.book,
        file: entry.file,
        chapter: chapter.chapter,
      });
      continue;
    }
    if (leadingVerse.test(firstLine)) {
      issues.push({
        type: 'chapter-starts-with-verse-marker',
        book: entry.book,
        file: entry.file,
        chapter: chapter.chapter,
        firstLine: firstLine.slice(0, 160),
      });
    }
    if (boxNoteHeading.test(firstLine)) {
      issues.push({
        type: 'possible-box-note-at-start',
        book: entry.book,
        file: entry.file,
        chapter: chapter.chapter,
        firstLine: firstLine.slice(0, 160),
      });
    }
    if (editorialHeadings.has(firstLine)) {
      issues.push({
        type: 'editorial-heading-at-start',
        book: entry.book,
        file: entry.file,
        chapter: chapter.chapter,
        firstLine,
      });
    }
    if (residualPageHeader.test(text)) {
      issues.push({
        type: 'residual-page-header',
        book: entry.book,
        file: entry.file,
        chapter: chapter.chapter,
      });
    }
  }
}

const summary = issues.reduce((acc, issue) => {
  acc[issue.type] = (acc[issue.type] ?? 0) + 1;
  return acc;
}, {});

mkdirSync(dirname(reportPath.pathname), { recursive: true });
writeFileSync(reportPath, JSON.stringify({ summary, issues }, null, 2) + '\n');

if (issues.length > 0) {
  console.error('Bible validation failed.');
  console.error(JSON.stringify(summary, null, 2));
  console.error(`Report: ${reportPath.pathname}`);
  process.exit(1);
}

console.log('Bible validation passed.');

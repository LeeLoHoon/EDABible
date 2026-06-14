import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bibleDir = new URL('../public/bible/', import.meta.url);
const reportPath = new URL('../reports/bible-validation.json', import.meta.url);

const index = JSON.parse(readFileSync(new URL('index.json', bibleDir), 'utf8'));
const files = readdirSync(bibleDir).filter((name) => name.endsWith('.json') && name !== 'index.json');

const fileSet = new Set(files);
const issues = [];

const leadingVerse = /^\s*\(?\d{1,3}(?:-\d{1,3})?\)?(?:\s|$)/;
const boxNoteHeading = /^\s*\([^)]*\d{1,3}:\d{1,3}(?:-\d{1,3})?[^)]*\)/;

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
  }
}

const summary = issues.reduce((acc, issue) => {
  acc[issue.type] = (acc[issue.type] ?? 0) + 1;
  return acc;
}, {});

writeFileSync(reportPath, JSON.stringify({ summary, issues }, null, 2) + '\n');

if (issues.length > 0) {
  console.error('Bible validation failed.');
  console.error(JSON.stringify(summary, null, 2));
  console.error(`Report: ${reportPath.pathname}`);
  process.exit(1);
}

console.log('Bible validation passed.');

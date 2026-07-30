/** 일반 회차 권에서 주제별 섹션이 시작하는 원본 쪽이다. */
export const SECTION = { meditation: 7, timothy: 43, bookStudy: 55 }

/** 00-01 권에서 주제별 섹션이 시작하는 원본 쪽이다. */
export const FIRST = { issue: '00-01', meditation: 113, timothy: 151, bookStudy: 163 }

/** 세트 전환 이전의 한국어·영어 회차별 권 목록이다. */
export const legacyBinderBooks = [
  { id: 'spl-00-01', issue: '00-01', file: 'spl-binder-00-01.pdf', pages: 172, lang: 'ko' },
  { id: 'spl-02', issue: '02', file: 'spl-binder-02.pdf', pages: 64, lang: 'ko' },
  { id: 'spl-03', issue: '03', file: 'spl-binder-03.pdf', pages: 64, lang: 'ko' },
  { id: 'spl-04', issue: '04', file: 'spl-binder-04.pdf', pages: 64, lang: 'ko' },
  { id: 'spl-05', issue: '05', file: 'spl-binder-05.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-06', issue: '06', file: 'spl-binder-06.pdf', pages: 64, lang: 'ko' },
  { id: 'spl-07', issue: '07', file: 'spl-binder-07.pdf', pages: 64, lang: 'ko' },
  { id: 'spl-08', issue: '08', file: 'spl-binder-08.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-09', issue: '09', file: 'spl-binder-09.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-10', issue: '10', file: 'spl-binder-10.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-11', issue: '11', file: 'spl-binder-11.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-12', issue: '12', file: 'spl-binder-12.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-13', issue: '13', file: 'spl-binder-13.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-14', issue: '14', file: 'spl-binder-14.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-15', issue: '15', file: 'spl-binder-15.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-16', issue: '16', file: 'spl-binder-16.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-17', issue: '17', file: 'spl-binder-17.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-18', issue: '18', file: 'spl-binder-18.pdf', pages: 66, lang: 'ko' },
  { id: 'spl-02-en', issue: '02', file: 'spl-binder-02-en.pdf', pages: 64, lang: 'en' },
  { id: 'spl-03-en', issue: '03', file: 'spl-binder-03-en.pdf', pages: 64, lang: 'en' },
  { id: 'spl-04-en', issue: '04', file: 'spl-binder-04-en.pdf', pages: 64, lang: 'en' },
  { id: 'spl-05-en', issue: '05', file: 'spl-binder-05-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-06-en', issue: '06', file: 'spl-binder-06-en.pdf', pages: 64, lang: 'en' },
  { id: 'spl-07-en', issue: '07', file: 'spl-binder-07-en.pdf', pages: 64, lang: 'en' },
  { id: 'spl-08-en', issue: '08', file: 'spl-binder-08-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-09-en', issue: '09', file: 'spl-binder-09-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-10-en', issue: '10', file: 'spl-binder-10-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-11-en', issue: '11', file: 'spl-binder-11-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-12-en', issue: '12', file: 'spl-binder-12-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-13-en', issue: '13', file: 'spl-binder-13-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-14-en', issue: '14', file: 'spl-binder-14-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-15-en', issue: '15', file: 'spl-binder-15-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-16-en', issue: '16', file: 'spl-binder-16-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-17-en', issue: '17', file: 'spl-binder-17-en.pdf', pages: 66, lang: 'en' },
  { id: 'spl-18-en', issue: '18', file: 'spl-binder-18-en.pdf', pages: 66, lang: 'en' },
]

const BOOK_BY_ID = new Map(legacyBinderBooks.map((book) => [book.id, book]))
const BOOKMARK_SUFFIX = { ko: ' (구 표지·목차)', en: ' (old cover)' }

function emptyField() {
  return { mode: 'text', text: '', strokes: [] }
}

function setIdFor(kind, lang) {
  return `spl-${kind}${lang === 'en' ? '-en' : ''}`
}

function findSet(sets, kind, lang) {
  return sets.find((set) => set.id === setIdFor(kind, lang))
}

function checkpointPage(set, issue) {
  return set?.checkpoints.find((checkpoint) => checkpoint.issue === issue)?.page
}

function sectionFor(book, page) {
  if (book.issue === FIRST.issue) {
    if (page < FIRST.meditation) return { kind: 'starter', start: 1 }
    if (page < FIRST.timothy) return { kind: 'meditation', start: FIRST.meditation }
    if (page < FIRST.bookStudy) return { kind: 'timothy', start: FIRST.timothy }
    return { kind: 'bookstudy', start: FIRST.bookStudy }
  }

  if (page < SECTION.meditation) return null
  if (page < SECTION.timothy) return { kind: 'meditation', start: SECTION.meditation }
  if (page < SECTION.bookStudy) return { kind: 'timothy', start: SECTION.timothy }
  return { kind: 'bookstudy', start: SECTION.bookStudy }
}

/** 옛 권의 쪽을 생성된 세트의 쪽 좌표로 변환한다. */
export function legacyPageToSet(bookId, page, sets) {
  const book = BOOK_BY_ID.get(bookId)
  if (!book || !Number.isInteger(page) || page < 1 || page > book.pages) return null

  const section = sectionFor(book, page)
  if (!section) return null
  if (section.kind === 'starter') {
    const set = findSet(sets, 'starter', book.lang)
    if (!set || page > set.pages) return null
    return { setId: set.id, page }
  }

  const set = findSet(sets, section.kind, book.lang)
  const start = checkpointPage(set, book.issue)
  if (!set || start === undefined) return null
  const targetPage = start + page - section.start
  if (targetPage < 1 || targetPage > set.pages) return null
  return { setId: set.id, page: targetPage }
}

function coverToIssueStart(book, page, sets) {
  if (book.issue === FIRST.issue || !Number.isInteger(page) || page < 1 || page >= SECTION.meditation) {
    return null
  }
  const set = findSet(sets, 'meditation', book.lang)
  const targetPage = checkpointPage(set, book.issue)
  return set && targetPage !== undefined ? { setId: set.id, page: targetPage } : null
}

function targetSetIds(book, sets) {
  if (book.issue === FIRST.issue) {
    return ['starter', 'meditation', 'timothy', 'bookstudy']
      .map((kind) => findSet(sets, kind, book.lang)?.id)
      .filter((id) => id !== undefined)
  }
  return ['meditation', 'timothy', 'bookstudy']
    .map((kind) => findSet(sets, kind, book.lang)?.id)
    .filter((id) => id !== undefined)
}

function newWork(bookId, updatedAt) {
  return {
    bookId,
    transcription: emptyField(),
    notes: emptyField(),
    pageInputs: {},
    pageTextBoxes: {},
    bookmarks: [],
    checkpointPages: {},
    updatedAt,
  }
}

function cloneWork(work) {
  return {
    ...work,
    transcription: { ...work.transcription, strokes: [...(work.transcription?.strokes ?? [])] },
    notes: { ...work.notes, strokes: [...(work.notes?.strokes ?? [])] },
    pageInputs: { ...(work.pageInputs ?? {}) },
    pageTextBoxes: Object.fromEntries(
      Object.entries(work.pageTextBoxes ?? {}).map(([page, boxes]) => [page, [...boxes]]),
    ),
    bookmarks: (work.bookmarks ?? []).map((bookmark) => ({ ...bookmark })),
    checkpointPages: { ...(work.checkpointPages ?? {}) },
  }
}

function fieldHasContent(field) {
  return (
    (typeof field?.text === 'string' && field.text.trim().length > 0) ||
    (Array.isArray(field?.strokes) && field.strokes.length > 0)
  )
}

function validLastPage(page, maximumPage) {
  return Number.isInteger(page) && page >= 1 && page <= maximumPage
}

/** migrated data 아래에 기존 target을 겹쳐 합친다. 같은 key/id에서는 existing이 이긴다. */
export function mergeBinderWorks(migrated, existing, maximumPage = Number.POSITIVE_INFINITY) {
  if (migrated.bookId !== existing.bookId) {
    throw new Error(`BinderWork merge target mismatch: ${migrated.bookId}/${existing.bookId}`)
  }

  const existingBookmarkIds = new Set()
  const existingBookmarks = (existing.bookmarks ?? []).filter((bookmark) => {
    if (existingBookmarkIds.has(bookmark.id)) return false
    existingBookmarkIds.add(bookmark.id)
    return true
  })
  const migratedBookmarkIds = new Set()
  const migratedBookmarks = (migrated.bookmarks ?? []).filter((bookmark) => {
    if (existingBookmarkIds.has(bookmark.id) || migratedBookmarkIds.has(bookmark.id)) return false
    migratedBookmarkIds.add(bookmark.id)
    return true
  })
  return {
    bookId: existing.bookId,
    transcription: fieldHasContent(existing.transcription)
      ? existing.transcription
      : migrated.transcription,
    notes: fieldHasContent(existing.notes) ? existing.notes : migrated.notes,
    pageInputs: { ...(migrated.pageInputs ?? {}), ...(existing.pageInputs ?? {}) },
    pageTextBoxes: { ...(migrated.pageTextBoxes ?? {}), ...(existing.pageTextBoxes ?? {}) },
    bookmarks: [...existingBookmarks, ...migratedBookmarks],
    ...(validLastPage(existing.lastPageNumber, maximumPage)
      ? { lastPageNumber: existing.lastPageNumber }
      : validLastPage(migrated.lastPageNumber, maximumPage)
        ? { lastPageNumber: migrated.lastPageNumber }
        : {}),
    checkpointPages: {
      ...(migrated.checkpointPages ?? {}),
      ...(existing.checkpointPages ?? {}),
    },
    updatedAt: Math.max(
      Number.isFinite(migrated.updatedAt) ? migrated.updatedAt : 0,
      Number.isFinite(existing.updatedAt) ? existing.updatedAt : 0,
    ),
  }
}

function copyPageRecord(source, field, oldBookId, sets, targets) {
  for (const [oldPage, value] of Object.entries(source ?? {})) {
    const mapped = legacyPageToSet(oldBookId, Number(oldPage), sets)
    if (!mapped) continue
    const target = targets.get(mapped.setId)
    if (!target) continue
    const key = String(mapped.page)
    if (Object.hasOwn(target[field], key)) {
      throw new Error(`${field} migration collision: ${mapped.setId} page ${key}`)
    }
    target[field][key] = value
  }
}

/** 옛 BinderWork 목록을 세트별 BinderWork 목록으로 병합한다. */
export function migrateLegacyWorks(oldWorks, sets) {
  const knownSetIds = new Set(sets.map((set) => set.id))
  const targets = new Map()
  const resumeCandidates = new Map()

  for (const work of oldWorks) {
    if (knownSetIds.has(work.bookId)) {
      if (targets.has(work.bookId)) throw new Error(`duplicate BinderWork: ${work.bookId}`)
      targets.set(work.bookId, cloneWork(work))
      continue
    }

    const book = BOOK_BY_ID.get(work.bookId)
    if (!book) continue
    const updatedAt = Number.isFinite(work.updatedAt) ? work.updatedAt : 0
    for (const setId of targetSetIds(book, sets)) {
      const target = targets.get(setId)
      if (target) {
        target.updatedAt = Math.max(target.updatedAt, updatedAt)
      } else {
        targets.set(setId, newWork(setId, updatedAt))
      }
    }

    copyPageRecord(work.pageInputs, 'pageInputs', work.bookId, sets, targets)
    copyPageRecord(work.pageTextBoxes, 'pageTextBoxes', work.bookId, sets, targets)

    for (const bookmark of work.bookmarks ?? []) {
      const direct = legacyPageToSet(work.bookId, bookmark.page, sets)
      const mapped = direct ?? coverToIssueStart(book, bookmark.page, sets)
      if (!mapped) continue
      const target = targets.get(mapped.setId)
      if (!target) continue
      target.bookmarks.push({
        ...bookmark,
        page: mapped.page,
        label: direct ? bookmark.label : `${bookmark.label}${BOOKMARK_SUFFIX[book.lang]}`,
      })
    }

    if (work.lastPageNumber !== undefined) {
      const direct = legacyPageToSet(work.bookId, work.lastPageNumber, sets)
      const mapped = direct ?? coverToIssueStart(book, work.lastPageNumber, sets)
      if (mapped) {
        const previous = resumeCandidates.get(mapped.setId)
        if (!previous || updatedAt > previous.updatedAt) {
          resumeCandidates.set(mapped.setId, { updatedAt, page: mapped.page })
        }
      }
    }

    for (const [oldKey, oldPage] of Object.entries(work.checkpointPages ?? {})) {
      const mapped = legacyPageToSet(work.bookId, oldPage, sets)
      if (!mapped) continue
      const target = targets.get(mapped.setId)
      if (!target) continue
      const key = mapped.setId === 'spl-starter' ? oldKey : `issue-${book.issue}`
      target.checkpointPages[key] = mapped.page
    }
  }

  for (const [setId, resume] of resumeCandidates) {
    const target = targets.get(setId)
    if (target) target.lastPageNumber = resume.page
  }

  return sets.flatMap((set) => {
    const target = targets.get(set.id)
    return target ? [target] : []
  })
}

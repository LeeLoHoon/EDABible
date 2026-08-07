import { emptyField, emptyTemptationVictory, type Entry, type Field } from './types'

/** 로그인 전에 이 기기에서 만든 묵상의 소유자 표시 — 로그인하면 계정으로 승계된다 */
export const ENTRY_LOCAL_OWNER = 'local'

/**
 * 로컬(IndexedDB)에 저장되는 묵상 한 건 — Entry 본문에 동기화 메타를 얹은 형태.
 * 화면은 Entry로만 다루고, 메타는 db 계층에서만 읽고 쓴다.
 */
export interface EntryRecord extends Entry {
  /** 계정 uuid 또는 ENTRY_LOCAL_OWNER */
  ownerId: string
  /** 서버가 확정한 revision. 아직 한 번도 올라간 적 없으면 0 */
  revision: number
  /** 서버에 아직 반영되지 않은 편집이 남아 있는지 */
  dirty?: boolean
  /** 다른 기기가 먼저 저장해 revision이 어긋났는지 — 사용자가 고를 때까지 자동 재전송하지 않는다 */
  conflict?: boolean
}

/** list_my_meditation_entries()가 돌려주는 메타 한 줄 (본문 data는 담기지 않는다) */
export interface RemoteEntryMeta {
  entryId: string
  revision: number
  deleted: boolean
}

export type EntryPullAction =
  /** 원격 본문을 받아 로컬을 교체한다 */
  | { kind: 'fetch'; entryId: string }
  /** 원격 tombstone — 로컬에서도 지운다 */
  | { kind: 'drop'; entryId: string }

/**
 * 원격 메타 목록과 로컬 캐시를 대조해 실제로 받아야 할 것만 고른다.
 * 본문(손글씨 획 포함)은 여기서 고른 행만 개별 조회한다 — 목록 한 번에 다 내려받으면 무겁다.
 */
export function selectEntryPullActions(
  remote: readonly RemoteEntryMeta[],
  local: ReadonlyMap<string, EntryRecord>,
): EntryPullAction[] {
  const actions: EntryPullAction[] = []
  for (const meta of remote) {
    const cached = local.get(meta.entryId)
    if (meta.deleted) {
      if (cached) actions.push({ kind: 'drop', entryId: meta.entryId })
      continue
    }
    // 아직 못 올린 편집이 있으면 원격으로 덮지 않는다 — push가 올리고, 어긋나면 충돌로 간다.
    if (cached?.dirty) continue
    if (!cached || cached.revision < meta.revision) {
      actions.push({ kind: 'fetch', entryId: meta.entryId })
    }
  }
  return actions
}

/**
 * 재전송 대상 — 충돌 표시된 행은 제외한다. 충돌은 서버가 계속 거절하므로 자동 재시도하면
 * 실패만 반복하고, 어느 쪽을 남길지는 사용자가 배너에서 고른다.
 */
export function selectPushableEntries(
  local: readonly EntryRecord[],
  ownerId: string,
): EntryRecord[] {
  return local.filter(
    (record) => record.ownerId === ownerId && record.dirty === true && record.conflict !== true,
  )
}

/** 로그인 전에 이 기기에 쌓인 묵상 — 로그인 시 계정으로 옮긴다 */
export function selectClaimableEntries(local: readonly EntryRecord[]): EntryRecord[] {
  return local.filter((record) => record.ownerId === ENTRY_LOCAL_OWNER)
}

/** 승계된 묵상은 계정에 처음 올리는 것이므로 revision 0(= insert 경로)에서 시작한다. */
export function claimEntryRecord(record: EntryRecord, userId: string): EntryRecord {
  return { ...record, ownerId: userId, revision: 0, dirty: true, conflict: false }
}

function normalizeField(value: unknown): Field {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyField()
  const source = value as Partial<Field>
  return {
    mode: source.mode === 'ink' ? 'ink' : 'text',
    text: typeof source.text === 'string' ? source.text : '',
    strokes: Array.isArray(source.strokes) ? source.strokes : [],
  }
}

function normalizeFields(value: unknown): Field[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeField)
}

function normalizeOptionalFields(value: unknown): Field[] | undefined {
  return Array.isArray(value) ? value.map(normalizeField) : undefined
}

/**
 * 원격 jsonb를 Entry로 되돌린다. 손상되었거나 id가 어긋나면 null — 깨진 데이터로
 * 멀쩡한 로컬 묵상을 덮어쓰지 않는다.
 */
export function normalizeRemoteEntry(entryId: string, raw: unknown): Entry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown> & Partial<Entry>
  if (typeof source.id !== 'string' || source.id !== entryId) return null

  const updatedAt = typeof source.updatedAt === 'number' ? source.updatedAt : 0
  const createdAt = typeof source.createdAt === 'number' ? source.createdAt : updatedAt
  const temptationVictory = {
    ...emptyTemptationVictory(),
    ...(typeof source.temptationVictory === 'object' && source.temptationVictory !== null
      ? source.temptationVictory
      : {}),
  }

  return {
    // 이 앱 버전이 모르는 key도 그대로 둔다 — 구버전 기기가 새 필드를 지워버리는 것 방지
    ...source,
    id: entryId,
    date: typeof source.date === 'string' ? source.date : '',
    bibleRef: typeof source.bibleRef === 'string' ? source.bibleRef : '',
    transcription: normalizeField(source.transcription),
    answers: normalizeFields(source.answers),
    spousePrayer: normalizeField(source.spousePrayer),
    prayerTopics: normalizeFields(source.prayerTopics),
    prayerTopics2: normalizeOptionalFields(source.prayerTopics2),
    spousePrayer2:
      source.spousePrayer2 === undefined ? undefined : normalizeField(source.spousePrayer2),
    temptationVictory,
    highlightRanges: Array.isArray(source.highlightRanges) ? source.highlightRanges : [],
    createdAt,
    updatedAt,
  }
}

/**
 * 원격에 올릴 JSON — 동기화 메타만 떼고 본문은 통째로 보낸다. 알려진 필드만 골라 담으면
 * 구버전 기기가 저장할 때 새 필드가 사라지므로, 모르는 key도 그대로 실어 보낸다.
 */
export function serializeEntry(record: EntryRecord): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...record }
  delete entry.ownerId
  delete entry.revision
  delete entry.dirty
  delete entry.conflict
  return entry
}

function messageIncludes(error: unknown, token: string): boolean {
  if (error instanceof Error) return error.message.includes(token)
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes(token)
  )
}

/** 다른 기기가 먼저 저장해 revision이 어긋난 경우 */
export function isStaleEntryError(error: unknown): boolean {
  return messageIncludes(error, 'MEDITATION_ENTRY_STALE_REVISION')
}

/** 다른 기기에서 이미 지워진 묵상에 저장을 시도한 경우 */
export function isDeletedEntryError(error: unknown): boolean {
  return messageIncludes(error, 'MEDITATION_ENTRY_DELETED')
}

export function entryRevisionFromResponse(data: unknown): number {
  if (
    typeof data !== 'object' ||
    data === null ||
    !('revision' in data) ||
    typeof data.revision !== 'number' ||
    !Number.isInteger(data.revision) ||
    data.revision < 1
  ) {
    throw new Error('MEDITATION_ENTRY_INVALID_RESPONSE')
  }
  return data.revision
}

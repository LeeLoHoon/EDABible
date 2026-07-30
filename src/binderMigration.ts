import { binderSets } from './binderSets'
import { toBinderCacheRecord } from './binderCache'
import {
  BINDER_LOCAL_OWNER,
  assertActiveSupabaseOwner,
  claimLegacyBinderWorks,
  db,
  isLegacyBinderClaimOwner,
  normalizeBinderWork,
  type BinderWork,
} from './db'
import { supabase } from './supabase'
import {
  legacyBinderBooks,
  legacyPageToSet,
  mergeBinderWorks,
  migrateLegacyWorks,
} from '../scripts/binder_legacy_map'

const PREVIOUS_MIGRATION_FLAG = 'edabible:binderSetsMigrated:v2'

export function binderMigrationFlag(ownerId: string): string {
  return `edabible:binderSetsMigrated:v3:${ownerId}`
}

/** pageInputs의 구 텍스트를 모든 쪽에서 한 번에 text box로 옮긴다. */
export function convertLegacyPageText(work: BinderWork): { work: BinderWork; changed: boolean } {
  let pageInputs = work.pageInputs
  let pageTextBoxes = work.pageTextBoxes
  let changed = false

  for (const [pageKey, field] of Object.entries(work.pageInputs)) {
    if (!field.text.trim() || (work.pageTextBoxes[pageKey] ?? []).length > 0) continue
    if (!changed) {
      pageInputs = { ...work.pageInputs }
      pageTextBoxes = { ...work.pageTextBoxes }
      changed = true
    }
    pageInputs[pageKey] = { ...field, text: '' }
    pageTextBoxes[pageKey] = [
      {
        id: crypto.randomUUID(),
        x: 0.08,
        y: 0.08,
        width: 0.52,
        text: field.text,
      },
    ]
  }

  if (!changed) return { work, changed: false }
  return { work: { ...work, pageInputs, pageTextBoxes }, changed: true }
}

/** 로그인 전에 로컬 IndexedDB에 쌓인 옛 바인더 데이터를 세트 좌표로 기기당 한 번 옮긴다. */
export async function migrateLocalBinderWorks(userId?: string): Promise<void> {
  const ownerId = userId ?? BINDER_LOCAL_OWNER
  try {
    if (userId) await claimLegacyBinderWorks(userId)
    const migrationFlag = binderMigrationFlag(ownerId)
    if (localStorage.getItem(migrationFlag) === '1') return
    if (
      userId &&
      (await isLegacyBinderClaimOwner(userId)) &&
      localStorage.getItem(PREVIOUS_MIGRATION_FLAG) === '1'
    ) {
      localStorage.setItem(migrationFlag, '1')
      return
    }

    const legacyIds = legacyBinderBooks.map((book) => book.id)
    const oldWorks = (
      await db.binderWorksByOwner.bulkGet(legacyIds.map((bookId) => [ownerId, bookId]))
    ).flatMap((record) => (record ? [record.work] : []))
    if (oldWorks.length === 0) {
      localStorage.setItem(migrationFlag, '1')
      return
    }

    const migrated = migrateLegacyWorks(oldWorks, binderSets)
    const targetIds = migrated.map((work) => work.bookId)
    const localTargets = await db.binderWorksByOwner.bulkGet(
      targetIds.map((bookId) => [ownerId, bookId]),
    )
    const localById = new Map(
      localTargets.flatMap((record) => (record ? [[record.bookId, record.work]] : [])),
    )
    const remoteById = new Map<string, BinderWork>()

    if (supabase && userId && targetIds.length > 0) {
      await assertActiveSupabaseOwner(userId, 'BINDER_OWNER_CHANGED')
      const { data, error } = await supabase
        .from('binder_works')
        .select('book_id, data')
        .eq('user_id', userId)
        .in('book_id', targetIds)
      if (error) throw error
      for (const row of data ?? []) {
        const bookId = row.book_id as string
        remoteById.set(bookId, normalizeBinderWork(bookId, row.data))
      }
    }

    for (const migratedWork of migrated) {
      const maximumPage = binderSets.find((set) => set.id === migratedWork.bookId)?.pages
      if (!maximumPage) continue
      const local = localById.get(migratedWork.bookId)
      const remote = remoteById.get(migratedWork.bookId)
      let existing: BinderWork | undefined
      if (local && remote) {
        existing =
          local.updatedAt >= remote.updatedAt
            ? mergeBinderWorks(remote, local, maximumPage)
            : mergeBinderWorks(local, remote, maximumPage)
      } else {
        existing = local ?? remote
      }
      const work = existing
        ? mergeBinderWorks(migratedWork, existing, maximumPage)
        : migratedWork

      if (supabase && userId) {
        await assertActiveSupabaseOwner(userId, 'BINDER_OWNER_CHANGED')
        const { error } = await supabase.from('binder_works').upsert({
          user_id: userId,
          book_id: work.bookId,
          data: work,
          updated_at: new Date(work.updatedAt).toISOString(),
        })
        if (error) throw error
      }
      const remotelySynced = Boolean(supabase && userId)
      await db.binderWorksByOwner.put(
        toBinderCacheRecord(
          ownerId,
          work,
          !remotelySynced,
          remotelySynced ? work.updatedAt : 0,
        ),
      )
    }

    localStorage.setItem(migrationFlag, '1')
  } catch (error) {
    // 오프라인·저장소 오류는 바인더 부팅을 막지 않고 다음 부팅에서 다시 시도한다.
    console.warn('Binder migration will be retried.', error)
  }
}

/** 옛 권의 마지막 쪽을 현재 세트의 이어보기 위치로 변환한다. */
export function resolveLegacyResume(
  bookId: string,
  lastPageNumber?: number,
): { setId: string; page: number } | undefined {
  if (lastPageNumber === undefined) return undefined
  return legacyPageToSet(bookId, lastPageNumber, binderSets) ?? undefined
}

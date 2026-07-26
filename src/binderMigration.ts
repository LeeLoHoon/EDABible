import { binderSets } from './binderSets'
import { db, type BinderWork } from './db'
import { supabase } from './supabase'
import {
  legacyBinderBooks,
  legacyPageToSet,
  migrateLegacyWorks,
} from '../scripts/binder_legacy_map'

const MIGRATION_FLAG = 'edabible:binderSetsMigrated:v1'

/** 로그인 전에 로컬 IndexedDB에 쌓인 옛 바인더 데이터를 세트 좌표로 기기당 한 번 옮긴다. */
export async function migrateLocalBinderWorks(userId?: string): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === '1') return

    const legacyIds = legacyBinderBooks.map((book) => book.id)
    const oldWorks = (await db.binderWorks.bulkGet(legacyIds)).filter(
      (work): work is BinderWork => work !== undefined,
    )
    if (oldWorks.length === 0) {
      localStorage.setItem(MIGRATION_FLAG, '1')
      return
    }

    const migrated = migrateLegacyWorks(oldWorks, binderSets)
    const targetIds = migrated.map((work) => work.bookId)
    const localTargets = await db.binderWorks.bulkGet(targetIds)
    const existingIds = new Set(
      localTargets.flatMap((work) => (work ? [work.bookId] : [])),
    )

    if (supabase && userId && targetIds.length > 0) {
      const { data, error } = await supabase
        .from('binder_works')
        .select('book_id')
        .eq('user_id', userId)
        .in('book_id', targetIds)
      if (error) throw error
      for (const row of data ?? []) existingIds.add(row.book_id as string)
    }

    for (const work of migrated) {
      if (existingIds.has(work.bookId)) continue
      if (supabase && userId) {
        const { error } = await supabase.from('binder_works').insert({
          user_id: userId,
          book_id: work.bookId,
          data: work,
          updated_at: new Date(work.updatedAt).toISOString(),
        })
        if (error) throw error
      }
      await db.binderWorks.put(work)
      existingIds.add(work.bookId)
    }

    localStorage.setItem(MIGRATION_FLAG, '1')
  } catch {
    // 오프라인·저장소 오류는 바인더 부팅을 막지 않고 다음 부팅에서 다시 시도한다.
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

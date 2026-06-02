import Dexie, { type Table } from 'dexie'
import type { Entry } from './types'

/** 로컬(IndexedDB) 저장소 — 로그인/서버 없이 동작. 추후 Supabase 동기화 예정. */
class EdaBibleDB extends Dexie {
  entries!: Table<Entry, string>

  constructor() {
    super('edabible')
    this.version(1).stores({
      // id: 기본키, date/updatedAt: 정렬·조회용 인덱스
      entries: 'id, date, updatedAt',
    })
  }
}

export const db = new EdaBibleDB()

export async function getEntry(id: string): Promise<Entry | undefined> {
  return db.entries.get(id)
}

export async function putEntry(entry: Entry): Promise<void> {
  await db.entries.put(entry)
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id)
}

/** 최신순 전체 목록 */
export async function listEntries(): Promise<Entry[]> {
  return db.entries.orderBy('updatedAt').reverse().toArray()
}

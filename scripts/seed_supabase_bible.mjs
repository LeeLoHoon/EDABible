import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const BUILD = process.env.npm_package_version ?? 'manual'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const index = await readJson('public/bible/index.json')
  let rows = []

  for (const meta of index) {
    const doc = await readJson(`public/bible/${meta.file}`)
    rows.push(
      ...doc.chapters.map((chapter) => ({
        book_order: meta.order,
        book: meta.book,
        abbr: meta.abbr,
        file: meta.file,
        chapter: chapter.chapter,
        text: chapter.text,
        source_build: BUILD,
      })),
    )
  }

  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100)
    const { error } = await supabase
      .from('bible_chapters')
      .upsert(chunk, { onConflict: 'book_order,chapter' })

    if (error) throw error
    process.stdout.write(`seeded ${Math.min(offset + chunk.length, rows.length)}/${rows.length}\n`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

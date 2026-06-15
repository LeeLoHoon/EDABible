-- EDABible shared Bible text storage.
-- Run in Supabase SQL Editor or apply with a Postgres connection.

create extension if not exists pgcrypto;

create table if not exists public.bible_chapters (
  book_order integer not null,
  book text not null,
  abbr text not null,
  file text not null,
  chapter integer not null,
  text text not null,
  is_finalized boolean not null default false,
  finalized_at timestamptz,
  source_build text,
  updated_at timestamptz not null default now(),
  primary key (book_order, chapter)
);

alter table public.bible_chapters
  add column if not exists is_finalized boolean not null default false;

alter table public.bible_chapters
  add column if not exists finalized_at timestamptz;

create table if not exists public.bible_chapter_edits (
  id uuid primary key default gen_random_uuid(),
  book_order integer not null,
  book text not null,
  chapter integer not null,
  previous_text text,
  next_text text not null,
  editor_label text not null default 'public-admin',
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists bible_chapters_file_idx
  on public.bible_chapters (file, chapter);

create index if not exists bible_chapter_edits_chapter_idx
  on public.bible_chapter_edits (book_order, chapter, created_at desc);

create or replace function public.touch_bible_chapters_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bible_chapters_touch_updated_at on public.bible_chapters;
create trigger bible_chapters_touch_updated_at
before update on public.bible_chapters
for each row execute function public.touch_bible_chapters_updated_at();

alter table public.bible_chapters enable row level security;
alter table public.bible_chapter_edits enable row level security;

drop policy if exists "public read bible chapters" on public.bible_chapters;
create policy "public read bible chapters"
on public.bible_chapters for select
to anon, authenticated
using (true);

drop policy if exists "public upsert bible chapters" on public.bible_chapters;
create policy "public upsert bible chapters"
on public.bible_chapters for insert
to anon, authenticated
with check (true);

drop policy if exists "public update bible chapters" on public.bible_chapters;
create policy "public update bible chapters"
on public.bible_chapters for update
to anon, authenticated
using (not is_finalized)
with check (true);

drop policy if exists "public read bible edits" on public.bible_chapter_edits;
create policy "public read bible edits"
on public.bible_chapter_edits for select
to anon, authenticated
using (true);

drop policy if exists "public insert bible edits" on public.bible_chapter_edits;
create policy "public insert bible edits"
on public.bible_chapter_edits for insert
to anon, authenticated
with check (true);

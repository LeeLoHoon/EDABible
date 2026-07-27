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

create table if not exists public.binder_works (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- 바인더 숨김 쪽을 관리할 수 있는 관리자 목록. 쓰기는 service role로만 수행한다.
create table if not exists public.binder_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- 세트별 원본 PDF 쪽번호를 전역 공유한다. 배열 값은 보이는 순번이 아니다.
create table if not exists public.binder_hidden_pages (
  set_id text primary key,
  pages int[] not null default '{}',
  updated_at timestamptz not null default now()
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
alter table public.binder_works enable row level security;
alter table public.binder_admins enable row level security;
alter table public.binder_hidden_pages enable row level security;

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

-- 완료 해제. 위 UPDATE 정책은 완료된 행을 아예 보이지 않게 하므로 플래그를 되돌리는
-- UPDATE조차 스스로에게 막힌다. RLS를 우회하는 security definer 함수로만 푼다.
-- 정책을 느슨하게 푸는 대신 함수로 두는 이유: 같은 UPDATE 문에서 text까지 덮어쓰는 것을
-- 막아 '해제 후 수정'이라는 두 단계를 강제하기 위함.
create or replace function public.unfinalize_bible_chapter(p_book_order int, p_chapter int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bible_chapters
     set is_finalized = false,
         finalized_at = null
   where book_order = p_book_order
     and chapter = p_chapter;
$$;

revoke all on function public.unfinalize_bible_chapter(int, int) from public;
grant execute on function public.unfinalize_bible_chapter(int, int) to anon, authenticated;

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

drop policy if exists "users read own binder works" on public.binder_works;
create policy "users read own binder works"
on public.binder_works for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users insert own binder works" on public.binder_works;
create policy "users insert own binder works"
on public.binder_works for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users update own binder works" on public.binder_works;
create policy "users update own binder works"
on public.binder_works for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users read own binder admin row" on public.binder_admins;
create policy "users read own binder admin row"
on public.binder_admins for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "public read binder hidden pages" on public.binder_hidden_pages;
create policy "public read binder hidden pages"
on public.binder_hidden_pages for select
to anon, authenticated
using (true);

drop policy if exists "admins insert binder hidden pages" on public.binder_hidden_pages;
create policy "admins insert binder hidden pages"
on public.binder_hidden_pages for insert
to authenticated
with check (
  auth.uid() in (select user_id from public.binder_admins)
);

drop policy if exists "admins update binder hidden pages" on public.binder_hidden_pages;
create policy "admins update binder hidden pages"
on public.binder_hidden_pages for update
to authenticated
using (
  auth.uid() in (select user_id from public.binder_admins)
)
with check (
  auth.uid() in (select user_id from public.binder_admins)
);

-- 주간 말씀 묵상. 설교 등록 관리자는 바인더 관리자와 별개 목록이며 쓰기는 service role로만 수행한다.
create table if not exists public.sermon_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('morning', 'afternoon')),
  -- 주일 날짜. 묵상 기간(다음 날 월요일~토요일)이 이 값에서 계산된다.
  preached_on date not null,
  title text not null,
  preacher text,
  passages jsonb not null default '[]',
  summary text,
  points jsonb not null default '[]',
  media_url text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preached_on, service)
);

create table if not exists public.sermon_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, sermon_id)
);

create index if not exists sermons_preached_on_idx
  on public.sermons (preached_on desc, service);

create or replace function public.touch_sermons_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sermons_touch_updated_at on public.sermons;
create trigger sermons_touch_updated_at
before update on public.sermons
for each row execute function public.touch_sermons_updated_at();

alter table public.sermon_admins enable row level security;
alter table public.sermons enable row level security;
alter table public.sermon_notes enable row level security;

drop policy if exists "users read own sermon admin row" on public.sermon_admins;
create policy "users read own sermon admin row"
on public.sermon_admins for select
to authenticated
using (auth.uid() = user_id);

-- 미게시 설교는 관리자에게만 보인다. anon은 auth.uid()가 null이라 published 조건만 남는다.
drop policy if exists "read published sermons" on public.sermons;
create policy "read published sermons"
on public.sermons for select
to anon, authenticated
using (
  published or auth.uid() in (select user_id from public.sermon_admins)
);

drop policy if exists "admins insert sermons" on public.sermons;
create policy "admins insert sermons"
on public.sermons for insert
to authenticated
with check (
  auth.uid() in (select user_id from public.sermon_admins)
);

drop policy if exists "admins update sermons" on public.sermons;
create policy "admins update sermons"
on public.sermons for update
to authenticated
using (
  auth.uid() in (select user_id from public.sermon_admins)
)
with check (
  auth.uid() in (select user_id from public.sermon_admins)
);

drop policy if exists "admins delete sermons" on public.sermons;
create policy "admins delete sermons"
on public.sermons for delete
to authenticated
using (
  auth.uid() in (select user_id from public.sermon_admins)
);

-- 묵상은 본인만 읽고 쓴다. 목사님 열람 기능을 붙일 때 확장할 지점은 아래 select 정책뿐이다.
drop policy if exists "users read own sermon notes" on public.sermon_notes;
create policy "users read own sermon notes"
on public.sermon_notes for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users insert own sermon notes" on public.sermon_notes;
create policy "users insert own sermon notes"
on public.sermon_notes for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users update own sermon notes" on public.sermon_notes;
create policy "users update own sermon notes"
on public.sermon_notes for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users delete own sermon notes" on public.sermon_notes;
create policy "users delete own sermon notes"
on public.sermon_notes for delete
to authenticated
using (auth.uid() = user_id);

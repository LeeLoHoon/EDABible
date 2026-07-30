-- EDABible shared Bible text storage.
-- Run in Supabase SQL Editor or apply with a Postgres connection.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  pgcrypto_schema text;
begin
  select pg_catalog.n.nspname
    into pgcrypto_schema
    from pg_catalog.pg_extension as e
    join pg_catalog.pg_namespace as n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if pgcrypto_schema is distinct from 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end;
$$;

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
set search_path = ''
as $$
  update public.bible_chapters as chapter_row
     set is_finalized = false,
         finalized_at = null
   where chapter_row.book_order = p_book_order
     and chapter_row.chapter = p_chapter;
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
  title_en text,
  preacher text,
  preacher_en text,
  passages jsonb not null default '[]',
  summary text,
  summary_en text,
  points jsonb not null default '[]',
  points_en jsonb,
  media_url text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (preached_on, service)
);

alter table public.sermons add column if not exists title_en text;
alter table public.sermons add column if not exists preacher_en text;
alter table public.sermons add column if not exists summary_en text;
alter table public.sermons add column if not exists points_en jsonb;

create table if not exists public.sermon_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  sermon_id uuid not null references public.sermons(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, sermon_id)
);

alter table public.sermon_notes
  add column if not exists revision integer not null default 1;
alter table public.sermon_notes drop constraint if exists sermon_notes_revision_check;
alter table public.sermon_notes
  add constraint sermon_notes_revision_check check (revision >= 1);

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

-- Full-json writes는 아래 expected-revision RPC로만 허용해 stale client overwrite를 막는다.
drop policy if exists "users insert own sermon notes" on public.sermon_notes;
drop policy if exists "users update own sermon notes" on public.sermon_notes;
revoke insert, update on table public.sermon_notes from public, anon, authenticated;
grant select on table public.sermon_notes to authenticated;

drop policy if exists "users delete own sermon notes" on public.sermon_notes;
create policy "users delete own sermon notes"
on public.sermon_notes for delete
to authenticated
using (auth.uid() = user_id);

drop function if exists public.put_sermon_note(uuid, integer, jsonb);

create or replace function public.put_sermon_note(
  p_owner_user_id uuid,
  p_sermon_id uuid,
  p_expected_revision integer,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_revision integer;
  next_revision integer;
  saved_at timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'SERMON_NOTE_AUTH_REQUIRED';
  end if;
  if p_owner_user_id is null or p_owner_user_id <> actor_id then
    raise exception using errcode = '42501', message = 'SERMON_NOTE_OWNER_MISMATCH';
  end if;
  if p_sermon_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or pg_catalog.jsonb_typeof(p_data) <> 'object'
     or coalesce(p_data ->> 'sermonId', '') <> p_sermon_id::text then
    raise exception using errcode = '22023', message = 'SERMON_NOTE_INVALID_ARGUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_sermon_id::text, 27072026)
  );

  select note.revision
    into current_revision
    from public.sermon_notes as note
   where note.user_id = actor_id
     and note.sermon_id = p_sermon_id
   for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'SERMON_NOTE_STALE_REVISION';
    end if;
    insert into public.sermon_notes (user_id, sermon_id, data, revision, updated_at)
    values (actor_id, p_sermon_id, p_data, 1, saved_at);
    next_revision := 1;
  else
    if current_revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'SERMON_NOTE_STALE_REVISION';
    end if;
    next_revision := current_revision + 1;
    update public.sermon_notes as note
       set data = p_data,
           revision = next_revision,
           updated_at = saved_at
     where note.user_id = actor_id
       and note.sermon_id = p_sermon_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'sermonId', p_sermon_id,
    'revision', next_revision,
    'updatedAt', saved_at
  );
end;
$$;

revoke all on function public.put_sermon_note(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.put_sermon_note(uuid, uuid, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 사용자 Q&A: 승인 자료 검색은 service role만, 초안·승인은 등록된 관리자만 수행한다.
-- ---------------------------------------------------------------------------

create extension if not exists vector with schema extensions;
grant usage on schema extensions to service_role;

do $$
declare
  vector_schema text;
begin
  select pg_catalog.n.nspname
    into vector_schema
    from pg_catalog.pg_extension as e
    join pg_catalog.pg_namespace as n on n.oid = e.extnamespace
   where e.extname = 'vector';

  if vector_schema is distinct from 'extensions' then
    execute 'alter extension vector set schema extensions';
  end if;
end;
$$;

create table if not exists public.qa_corpus_versions (
  id uuid primary key default gen_random_uuid(),
  version_key text not null unique check (version_key = 'v1'),
  embedding_model text not null check (embedding_model = 'text-embedding-3-small'),
  embedding_dimension integer not null check (embedding_dimension = 1536),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Corpus version은 dataset snapshot이 아니라 immutable retrieval contract다. 과거 schema의
-- dataset-derived hash만 제거하며 source/chunk content hash는 그대로 보존한다.
alter table public.qa_corpus_versions drop column if exists content_hash;

-- 이전 실행에서 immutable trigger가 이미 존재해도 이 단일 controlled block 안에서만 seed를
-- 허용한다. transaction-local GUC는 block 종료 전에 즉시 원복한다.
do $$
begin
  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'on', true);
  insert into public.qa_corpus_versions (
    version_key,
    embedding_model,
    embedding_dimension
  ) values (
    'v1',
    'text-embedding-3-small',
    1536
  )
  on conflict (version_key) do nothing;

  if not exists (
    select 1
      from public.qa_corpus_versions as corpus
     where corpus.version_key = 'v1'
       and corpus.embedding_model = 'text-embedding-3-small'
       and corpus.embedding_dimension = 1536
  ) then
    raise exception using errcode = 'P0001', message = 'QA_CORPUS_CONTRACT_MISMATCH';
  end if;
  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'off', true);
end;
$$;

create table if not exists public.qa_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.qa_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_token uuid not null,
  question text not null check (char_length(question) between 2 and 4000),
  lang text not null default 'ko' check (lang in ('ko', 'en')),
  status text not null default 'submitted'
    check (status in ('submitted', 'drafting', 'draft_ready', 'failed', 'approved', 'rejected')),
  version integer not null default 1 check (version >= 1),
  draft_attempts integer not null default 0 check (draft_attempts between 0 and 3),
  draft_claimed_at timestamptz,
  draft_restore_status text check (draft_restore_status is null or draft_restore_status = 'draft_ready'),
  failure_code text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_token)
);

create table if not exists public.qa_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null unique references public.qa_questions(id) on delete cascade,
  working_body text not null default '' check (char_length(working_body) <= 30000),
  promotion_content_hash text check (
    promotion_content_hash is null or promotion_content_hash ~ '^[0-9a-f]{64}$'
  ),
  insufficient_evidence boolean not null default false,
  status text not null default 'drafting'
    check (status in ('drafting', 'draft_ready', 'failed', 'approved')),
  pre_claim_status text
    check (pre_claim_status is null or pre_claim_status in ('pending', 'drafting', 'draft_ready', 'failed')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qa_revisions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.qa_answers(id) on delete cascade,
  question_id uuid not null references public.qa_questions(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  body text not null check (char_length(body) between 1 and 35000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (answer_id, revision_number)
);

create table if not exists public.qa_sources (
  id uuid primary key default gen_random_uuid(),
  corpus_version_id uuid not null references public.qa_corpus_versions(id) on delete restrict,
  source_kind text not null default 'historical_qa'
    check (source_kind in ('historical_qa', 'document', 'published_answer')),
  title text not null check (char_length(title) between 1 and 500),
  public_url text check (public_url is null or public_url ~ '^https://'),
  storage_path text,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  answer_revision_id uuid unique references public.qa_revisions(id) on delete restrict,
  active boolean not null default true,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint qa_sources_storage_path_check check (
    (source_kind = 'published_answer' and storage_path is null and answer_revision_id is not null)
    or (
      source_kind <> 'published_answer'
      and storage_path is not null
      and storage_path !~ '(^|/)\.\.(/|$)'
      and answer_revision_id is null
    )
  )
);

-- Legacy query embedding은 machine metadata이며 사용자 작성 내용이 아니다. Query embedding을
-- answer corpus embedding으로 재사용하지 않도록 column만 제거하고 working_body/revision은 보존한다.
alter table public.qa_answers drop column if exists question_embedding;
alter table public.qa_answers
  add column if not exists promotion_content_hash text;
alter table public.qa_answers
  add column if not exists insufficient_evidence boolean not null default false;
alter table public.qa_questions
  add column if not exists draft_claimed_at timestamptz;
alter table public.qa_questions
  add column if not exists draft_restore_status text;
alter table public.qa_questions drop constraint if exists qa_questions_draft_restore_status_check;
alter table public.qa_questions
  add constraint qa_questions_draft_restore_status_check
  check (draft_restore_status is null or draft_restore_status = 'draft_ready');
alter table public.qa_answers
  add column if not exists pre_claim_status text;
alter table public.qa_answers drop constraint if exists qa_answers_pre_claim_status_check;
alter table public.qa_answers
  add constraint qa_answers_pre_claim_status_check
  check (pre_claim_status is null or pre_claim_status in ('pending', 'drafting', 'draft_ready', 'failed'));
alter table public.qa_questions drop constraint if exists qa_questions_draft_attempts_check;
alter table public.qa_questions
  add constraint qa_questions_draft_attempts_check check (draft_attempts >= 0);
alter table public.qa_answers drop constraint if exists qa_answers_promotion_content_hash_check;
alter table public.qa_answers
  add constraint qa_answers_promotion_content_hash_check
  check (promotion_content_hash is null or promotion_content_hash ~ '^[0-9a-f]{64}$');
alter table public.qa_sources
  add column if not exists answer_revision_id uuid references public.qa_revisions(id) on delete restrict;
alter table public.qa_sources
  add column if not exists active boolean not null default true;
-- 기존 reapproval history가 여러 active source로 남아 있다면 lineage별 최신 revision만 활성화한다.
do $$
begin
  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'on', true);
  with ranked_sources as (
    select source_row.id,
           pg_catalog.row_number() over (
             partition by revision.answer_id
             order by revision.revision_number desc, source_row.created_at desc, source_row.id desc
           ) as lineage_rank
      from public.qa_sources as source_row
      join public.qa_revisions as revision on revision.id = source_row.answer_revision_id
     where source_row.source_kind = 'published_answer'
       and source_row.active
  )
  update public.qa_sources as source_row
     set active = false
    from ranked_sources
   where ranked_sources.id = source_row.id
     and ranked_sources.lineage_rank > 1;
  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'off', true);
end;
$$;
create unique index if not exists qa_sources_answer_revision_idx
  on public.qa_sources (answer_revision_id) where answer_revision_id is not null;
alter table public.qa_sources drop constraint if exists qa_sources_content_hash_key;
create unique index if not exists qa_sources_import_content_hash_idx
  on public.qa_sources (content_hash) where source_kind <> 'published_answer';
alter table public.qa_sources alter column storage_path drop not null;
alter table public.qa_sources drop constraint if exists qa_sources_source_kind_check;
alter table public.qa_sources
  add constraint qa_sources_source_kind_check
  check (source_kind in ('historical_qa', 'document', 'published_answer'));
alter table public.qa_sources drop constraint if exists qa_sources_storage_path_check;
alter table public.qa_sources
  add constraint qa_sources_storage_path_check
  check (
    (source_kind = 'published_answer' and storage_path is null and answer_revision_id is not null)
    or (
      source_kind <> 'published_answer'
      and storage_path is not null
      and storage_path !~ '(^|/)\.\.(/|$)'
      and answer_revision_id is null
    )
  );

create table if not exists public.qa_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.qa_sources(id) on delete restrict,
  corpus_version_id uuid not null references public.qa_corpus_versions(id) on delete restrict,
  chunk_index integer not null check (chunk_index >= 0),
  body text not null check (char_length(body) between 1 and 30000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  search_vector tsvector generated always as (to_tsvector('simple', body)) stored,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index),
  unique (source_id, content_hash)
);

alter table public.qa_chunks drop constraint if exists qa_chunks_body_check;
alter table public.qa_chunks
  add constraint qa_chunks_body_check check (char_length(body) between 1 and 35000);
alter table public.qa_chunks alter column embedding drop not null;

create or replace function public.qa_invalidate_answer_promotion_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.working_body is distinct from old.working_body
     and new.promotion_content_hash is not distinct from old.promotion_content_hash then
    new.promotion_content_hash := null;
  end if;
  return new;
end;
$$;

drop trigger if exists qa_answers_invalidate_promotion_metadata on public.qa_answers;
create trigger qa_answers_invalidate_promotion_metadata
before update of working_body on public.qa_answers
for each row execute function public.qa_invalidate_answer_promotion_metadata();

create table if not exists public.qa_citations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.qa_answers(id) on delete cascade,
  chunk_id uuid not null references public.qa_chunks(id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  excerpt text not null check (char_length(excerpt) between 1 and 600),
  created_at timestamptz not null default now(),
  unique (answer_id, ordinal),
  unique (answer_id, chunk_id)
);

create table if not exists public.qa_published_answers (
  question_id uuid primary key references public.qa_questions(id) on delete cascade,
  revision_id uuid not null unique references public.qa_revisions(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 30000),
  lang text not null check (lang in ('ko', 'en')),
  published_at timestamptz not null default now()
);

-- 공개 citation에는 내부 chunk 식별자·score·storage path·vector·prompt·원문 body가 없다.
create table if not exists public.qa_published_citations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.qa_published_answers(question_id) on delete cascade,
  revision_id uuid not null references public.qa_revisions(id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  source_title text not null check (char_length(source_title) between 1 and 500),
  source_url text check (source_url is null or source_url ~ '^https://'),
  excerpt text not null check (char_length(excerpt) between 1 and 600),
  unique (question_id, ordinal)
);

create index if not exists qa_questions_user_created_idx
  on public.qa_questions (user_id, created_at desc);
create index if not exists qa_questions_status_updated_idx
  on public.qa_questions (status, updated_at);
create index if not exists qa_answers_status_updated_idx
  on public.qa_answers (status, updated_at);
create index if not exists qa_revisions_question_created_idx
  on public.qa_revisions (question_id, created_at desc);
create index if not exists qa_sources_corpus_idx
  on public.qa_sources (corpus_version_id, created_at);
create index if not exists qa_chunks_source_idx
  on public.qa_chunks (source_id, chunk_index);
create index if not exists qa_chunks_fts_idx
  on public.qa_chunks using gin (search_vector);
create index if not exists qa_citations_answer_idx
  on public.qa_citations (answer_id, ordinal);
create index if not exists qa_published_citations_question_idx
  on public.qa_published_citations (question_id, ordinal);

create or replace function public.qa_guard_approved_corpus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('edabible.qa_corpus_mutation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception using errcode = '42501', message = 'QA_APPROVED_CORPUS_IMMUTABLE';
end;
$$;

drop trigger if exists qa_corpus_versions_immutable on public.qa_corpus_versions;
create trigger qa_corpus_versions_immutable
before insert or update or delete on public.qa_corpus_versions
for each row execute function public.qa_guard_approved_corpus();

drop trigger if exists qa_sources_immutable on public.qa_sources;
create trigger qa_sources_immutable
before insert or update or delete on public.qa_sources
for each row execute function public.qa_guard_approved_corpus();

drop trigger if exists qa_chunks_immutable on public.qa_chunks;
create trigger qa_chunks_immutable
before insert or update or delete on public.qa_chunks
for each row execute function public.qa_guard_approved_corpus();

alter table public.qa_corpus_versions enable row level security;
alter table public.qa_admins enable row level security;
alter table public.qa_questions enable row level security;
alter table public.qa_answers enable row level security;
alter table public.qa_revisions enable row level security;
alter table public.qa_sources enable row level security;
alter table public.qa_chunks enable row level security;
alter table public.qa_citations enable row level security;
alter table public.qa_published_answers enable row level security;
alter table public.qa_published_citations enable row level security;

-- 이전 draft의 약한 policy가 남지 않도록 Q&A table의 policy를 모두 제거한 뒤 필요한 것만 만든다.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename = any (array[
         'qa_corpus_versions', 'qa_admins', 'qa_questions', 'qa_answers', 'qa_revisions',
         'qa_sources', 'qa_chunks', 'qa_citations', 'qa_published_answers',
         'qa_published_citations'
       ])
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

revoke all on table public.qa_corpus_versions from public, anon, authenticated;
revoke all on table public.qa_admins from public, anon, authenticated;
revoke all on table public.qa_questions from public, anon, authenticated;
revoke all on table public.qa_answers from public, anon, authenticated;
revoke all on table public.qa_revisions from public, anon, authenticated;
revoke all on table public.qa_sources from public, anon, authenticated;
revoke all on table public.qa_chunks from public, anon, authenticated;
revoke all on table public.qa_citations from public, anon, authenticated;
revoke all on table public.qa_published_answers from public, anon, authenticated;
revoke all on table public.qa_published_citations from public, anon, authenticated;

grant select on table public.qa_admins to authenticated;
grant select on table public.qa_questions to authenticated;
grant select (
  id,
  question_id,
  working_body,
  insufficient_evidence,
  status,
  updated_by,
  created_at,
  updated_at
)
  on table public.qa_answers to authenticated;
grant select on table public.qa_revisions to authenticated;
grant select (id, answer_id, ordinal, excerpt)
  on table public.qa_citations to authenticated;
grant select on table public.qa_published_answers to authenticated;
grant select on table public.qa_published_citations to authenticated;

grant all on table public.qa_corpus_versions to service_role;
grant all on table public.qa_admins to service_role;
grant all on table public.qa_questions to service_role;
grant all on table public.qa_answers to service_role;
grant all on table public.qa_revisions to service_role;
grant all on table public.qa_sources to service_role;
grant all on table public.qa_chunks to service_role;
grant all on table public.qa_citations to service_role;
grant all on table public.qa_published_answers to service_role;
grant all on table public.qa_published_citations to service_role;

create policy "qa users read own admin row"
on public.qa_admins for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy "qa owners and admins read questions"
on public.qa_questions for select to authenticated
using (
  (select auth.uid()) is not null
  and (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.qa_admins as admin_row
       where admin_row.user_id = (select auth.uid())
    )
  )
);

create policy "qa admins read answers"
on public.qa_answers for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.qa_admins as admin_row
     where admin_row.user_id = (select auth.uid())
  )
);

create policy "qa admins read revisions"
on public.qa_revisions for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.qa_admins as admin_row
     where admin_row.user_id = (select auth.uid())
  )
);

create policy "qa admins read sources"
on public.qa_sources for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.qa_admins as admin_row
     where admin_row.user_id = (select auth.uid())
  )
);

create policy "qa admins read internal citations"
on public.qa_citations for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.qa_admins as admin_row
     where admin_row.user_id = (select auth.uid())
  )
);

create policy "qa owners and admins read published answers"
on public.qa_published_answers for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
      from public.qa_questions as question_row
     where question_row.id = qa_published_answers.question_id
       and (
         question_row.user_id = (select auth.uid())
         or exists (
           select 1 from public.qa_admins as admin_row
            where admin_row.user_id = (select auth.uid())
         )
       )
  )
);

create policy "qa owners and admins read published citations"
on public.qa_published_citations for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
      from public.qa_questions as question_row
     where question_row.id = qa_published_citations.question_id
       and (
         question_row.user_id = (select auth.uid())
         or exists (
           select 1 from public.qa_admins as admin_row
            where admin_row.user_id = (select auth.uid())
         )
       )
  )
);

create or replace function public.qa_submit_question(
  p_question text,
  p_lang text,
  p_client_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_question public.qa_questions%rowtype;
  inserted_question public.qa_questions%rowtype;
  recent_hour integer;
  recent_day integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if p_client_token is null then
    raise exception using errcode = '22023', message = 'QA_CLIENT_TOKEN_REQUIRED';
  end if;
  if p_lang not in ('ko', 'en') then
    raise exception using errcode = '22023', message = 'QA_INVALID_LANG';
  end if;
  if p_question is null or pg_catalog.char_length(pg_catalog.btrim(p_question)) not between 2 and 4000 then
    raise exception using errcode = '22023', message = 'QA_INVALID_QUESTION';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text, 7012026)
  );

  select question_row.*
    into existing_question
    from public.qa_questions as question_row
   where question_row.user_id = actor_id
     and question_row.client_token = p_client_token;

  if found then
    if existing_question.question <> pg_catalog.btrim(p_question)
       or existing_question.lang <> p_lang then
      raise exception using errcode = 'P0001', message = 'QA_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'id', existing_question.id,
      'question', existing_question.question,
      'lang', existing_question.lang,
      'status', existing_question.status,
      'version', existing_question.version,
      'draftClaimedAt', existing_question.draft_claimed_at,
      'createdAt', existing_question.created_at,
      'updatedAt', existing_question.updated_at
    );
  end if;

  select pg_catalog.count(*)::integer
    into recent_hour
    from public.qa_questions as question_row
   where question_row.user_id = actor_id
     and question_row.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_hour >= 5 then
    raise exception using errcode = 'P0001', message = 'QA_RATE_LIMIT_HOUR';
  end if;

  select pg_catalog.count(*)::integer
    into recent_day
    from public.qa_questions as question_row
   where question_row.user_id = actor_id
     and question_row.created_at >= pg_catalog.clock_timestamp() - interval '1 day';
  if recent_day >= 20 then
    raise exception using errcode = 'P0001', message = 'QA_RATE_LIMIT_DAY';
  end if;

  insert into public.qa_questions (user_id, client_token, question, lang)
  values (actor_id, p_client_token, pg_catalog.btrim(p_question), p_lang)
  returning * into inserted_question;

  return pg_catalog.jsonb_build_object(
    'id', inserted_question.id,
    'question', inserted_question.question,
    'lang', inserted_question.lang,
    'status', inserted_question.status,
    'version', inserted_question.version,
    'draftClaimedAt', inserted_question.draft_claimed_at,
    'createdAt', inserted_question.created_at,
    'updatedAt', inserted_question.updated_at
  );
end;
$$;

create or replace function public.qa_claim_draft(
  p_question_id uuid,
  p_expected_version integer,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  answer_id uuid;
  preserved_body text;
  next_version integer;
  claimed_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null or p_force is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status = 'drafting'
     and question_row.draft_claimed_at is not null
     and question_row.draft_claimed_at > pg_catalog.clock_timestamp() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'QA_DRAFT_LEASE_ACTIVE';
  end if;
  if question_row.status not in ('submitted', 'failed', 'drafting')
     and not (p_force and question_row.status = 'draft_ready') then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;
  if question_row.draft_attempts >= 3
     and not (
       p_force
       and question_row.status in ('failed', 'draft_ready', 'drafting')
     ) then
    raise exception using errcode = 'P0001', message = 'QA_DRAFT_ATTEMPT_LIMIT';
  end if;

  claimed_at := pg_catalog.clock_timestamp();
  insert into public.qa_answers (question_id, working_body, status, updated_by)
  values (question_row.id, '', 'drafting', actor_id)
  on conflict (question_id) do update
     set status = 'drafting',
         pre_claim_status = public.qa_answers.status,
         updated_by = actor_id,
         updated_at = pg_catalog.clock_timestamp()
  returning id, working_body into answer_id, preserved_body;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = 'drafting',
          version = next_version,
           draft_attempts = q.draft_attempts + 1,
           draft_claimed_at = claimed_at,
           draft_restore_status = case
             when pg_catalog.char_length(pg_catalog.btrim(pg_catalog.coalesce(preserved_body, ''))) > 0
              and question_row.status in ('draft_ready', 'failed', 'drafting') then 'draft_ready'
             else null
           end,
           failure_code = null,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'answerId', answer_id,
    'question', question_row.question,
    'lang', question_row.lang,
    'status', 'drafting',
    'version', next_version,
    'claimedAt', claimed_at,
    'attempt', question_row.draft_attempts + 1
  );
end;
$$;

drop function if exists public.qa_complete_insufficient_draft(uuid, integer);
drop function if exists public.qa_complete_insufficient_draft(uuid, integer, boolean);
create or replace function public.qa_complete_insufficient_draft(
  p_question_id uuid,
  p_expected_version integer,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  answer_row public.qa_answers%rowtype;
  answer_id uuid;
  fixed_body text;
  result_body text;
  result_insufficient boolean;
  preserve_existing boolean := false;
  next_version integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null or p_force is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status = 'drafting'
     and question_row.draft_claimed_at is not null
     and question_row.draft_claimed_at > pg_catalog.clock_timestamp() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'QA_DRAFT_LEASE_ACTIVE';
  end if;
  if question_row.status not in ('submitted', 'failed')
     and not (
       p_force
       and question_row.status in ('draft_ready', 'drafting')
     ) then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  fixed_body := case
    when question_row.lang = 'en'
      then 'There is not enough approved evidence to create a draft answer.'
    else '관련 승인 자료가 충분하지 않아 답변 초안을 만들 수 없습니다.'
  end;

  select answer.* into answer_row
    from public.qa_answers as answer
   where answer.question_id = question_row.id
   for update;

  preserve_existing := found
    and answer_row.insufficient_evidence = false
    and pg_catalog.char_length(pg_catalog.btrim(coalesce(answer_row.working_body, ''))) > 0
    and answer_row.promotion_content_hash is not null;

  if preserve_existing then
    update public.qa_answers as answer
       set status = 'draft_ready',
           pre_claim_status = null,
           updated_by = actor_id,
           updated_at = pg_catalog.clock_timestamp()
     where answer.id = answer_row.id;
    answer_id := answer_row.id;
    result_body := answer_row.working_body;
    result_insufficient := false;
  else
    insert into public.qa_answers (
      question_id,
      working_body,
      promotion_content_hash,
      insufficient_evidence,
      status,
      updated_by
    ) values (
      question_row.id,
      fixed_body,
      pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(fixed_body, 'UTF8'), 'sha256'),
        'hex'
      ),
      true,
      'draft_ready',
      actor_id
    )
    on conflict (question_id) do update
       set working_body = excluded.working_body,
           promotion_content_hash = excluded.promotion_content_hash,
           insufficient_evidence = true,
           status = 'draft_ready',
           pre_claim_status = null,
           updated_by = actor_id,
           updated_at = pg_catalog.clock_timestamp()
    returning id into answer_id;

    delete from public.qa_citations as citation_row
     where citation_row.answer_id = answer_id;
    result_body := fixed_body;
    result_insufficient := true;
  end if;

  next_version := question_row.version + 1;
  update public.qa_questions as q
      set status = 'draft_ready',
           version = next_version,
           draft_claimed_at = null,
           draft_restore_status = null,
          failure_code = null,
         rejection_reason = null,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'answerId', answer_id,
    'workingBody', result_body,
    'insufficientEvidence', result_insufficient,
    'preservedExistingDraft', preserve_existing,
    'status', 'draft_ready',
    'version', next_version
  );
end;
$$;

drop function if exists public.qa_complete_draft(uuid, integer, text, jsonb);
drop function if exists public.qa_complete_draft(
  uuid,
  integer,
  text,
  jsonb,
  extensions.vector,
  text
);
drop function if exists public.qa_complete_draft(uuid, integer, text, jsonb, text, text);
create or replace function public.qa_complete_draft(
  p_question_id uuid,
  p_expected_version integer,
  p_working_body text,
  p_citations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  answer_id uuid;
  citation_count integer;
  valid_citation_count integer;
  next_version integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;
  if p_working_body is null
     or pg_catalog.char_length(pg_catalog.btrim(p_working_body)) not between 1 and 30000 then
    raise exception using errcode = '22023', message = 'QA_INVALID_DRAFT';
  end if;
  if pg_catalog.jsonb_typeof(p_citations) <> 'array' then
    raise exception using errcode = '22023', message = 'QA_INVALID_CITATIONS';
  end if;

  citation_count := pg_catalog.jsonb_array_length(p_citations);
  if citation_count not between 1 and 12 then
    raise exception using errcode = '22023', message = 'QA_INVALID_CITATIONS';
  end if;
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_citations) as citation(value)
     where not (citation.value ? 'chunkId')
        or (citation.value ->> 'chunkId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not (citation.value ? 'ordinal')
        or (citation.value ->> 'ordinal') !~ '^[0-9]{1,2}$'
        or (citation.value ->> 'ordinal')::integer not between 0 and 11
  ) then
    raise exception using errcode = '22023', message = 'QA_INVALID_CITATIONS';
  end if;

  select pg_catalog.count(distinct chunk_row.id)::integer
    into valid_citation_count
    from pg_catalog.jsonb_array_elements(p_citations) as citation(value)
    join public.qa_chunks as chunk_row
      on chunk_row.id = (citation.value ->> 'chunkId')::uuid
    join public.qa_sources as source_row on source_row.id = chunk_row.source_id
    join public.qa_corpus_versions as corpus_row
      on corpus_row.id = chunk_row.corpus_version_id
     and corpus_row.id = source_row.corpus_version_id
   where corpus_row.version_key = 'v1'
     and corpus_row.embedding_model = 'text-embedding-3-small'
     and corpus_row.embedding_dimension = 1536
     and source_row.active;
  if valid_citation_count <> citation_count then
    raise exception using errcode = '22023', message = 'QA_UNAPPROVED_CITATION';
  end if;
  if (
    select pg_catalog.count(distinct (citation.value ->> 'ordinal')::integer)
      from pg_catalog.jsonb_array_elements(p_citations) as citation(value)
  ) <> citation_count then
    raise exception using errcode = '22023', message = 'QA_INVALID_CITATIONS';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status <> 'drafting' then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  update public.qa_answers as answer_row
     set working_body = pg_catalog.btrim(p_working_body),
         promotion_content_hash = pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(pg_catalog.btrim(p_working_body), 'UTF8'),
             'sha256'
           ),
           'hex'
         ),
          insufficient_evidence = false,
          status = 'draft_ready',
          pre_claim_status = null,
         updated_by = actor_id,
         updated_at = pg_catalog.clock_timestamp()
   where answer_row.question_id = question_row.id
     and answer_row.status = 'drafting'
  returning answer_row.id into answer_id;
  if answer_id is null then
    raise exception using errcode = 'P0001', message = 'QA_ANSWER_STATE_MISMATCH';
  end if;

  delete from public.qa_citations as citation_row where citation_row.answer_id = answer_id;
  insert into public.qa_citations (answer_id, chunk_id, ordinal, excerpt)
  select answer_id,
         chunk_row.id,
         (citation.value ->> 'ordinal')::integer,
         pg_catalog.left(pg_catalog.btrim(chunk_row.body), 600)
    from pg_catalog.jsonb_array_elements(p_citations) as citation(value)
    join public.qa_chunks as chunk_row
      on chunk_row.id = (citation.value ->> 'chunkId')::uuid
   order by (citation.value ->> 'ordinal')::integer;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = 'draft_ready',
           version = next_version,
           draft_claimed_at = null,
           draft_restore_status = null,
          failure_code = null,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'answerId', answer_id,
    'status', 'draft_ready',
    'version', next_version
  );
end;
$$;

drop function if exists public.qa_update_working_answer(uuid, integer, text);
drop function if exists public.qa_update_working_answer(uuid, integer, text, text);
create or replace function public.qa_update_working_answer(
  p_question_id uuid,
  p_expected_version integer,
  p_working_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  answer_id uuid;
  next_version integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null
     or p_working_body is null
     or pg_catalog.char_length(pg_catalog.btrim(p_working_body)) not between 1 and 30000 then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status <> 'draft_ready' then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  update public.qa_answers as answer_row
     set working_body = pg_catalog.btrim(p_working_body),
         promotion_content_hash = pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(pg_catalog.btrim(p_working_body), 'UTF8'),
             'sha256'
           ),
           'hex'
         ),
         updated_by = actor_id,
         updated_at = pg_catalog.clock_timestamp()
   where answer_row.question_id = question_row.id
     and answer_row.status = 'draft_ready'
  returning answer_row.id into answer_id;
  if answer_id is null then
    raise exception using errcode = 'P0001', message = 'QA_ANSWER_STATE_MISMATCH';
  end if;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set version = next_version,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'answerId', answer_id,
    'status', question_row.status,
    'version', next_version
  );
end;
$$;

create or replace function public.qa_fail_draft(
  p_question_id uuid,
  p_expected_version integer,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  next_version integer;
  restored boolean;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null
     or p_failure_code not in ('timeout', 'provider_error', 'retrieval_error', 'internal_error') then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status <> 'drafting' then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  if question_row.draft_restore_status = 'draft_ready' then
    update public.qa_answers as answer_row
       set status = 'draft_ready',
           pre_claim_status = null,
           updated_by = actor_id,
           updated_at = pg_catalog.clock_timestamp()
     where answer_row.question_id = question_row.id
       and answer_row.status = 'drafting';
    restored := true;
  else
    update public.qa_answers as answer_row
       set status = 'failed',
           pre_claim_status = null,
           updated_by = actor_id,
           updated_at = pg_catalog.clock_timestamp()
     where answer_row.question_id = question_row.id
       and answer_row.status = 'drafting';
    restored := false;
  end if;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = case when restored then 'draft_ready' else 'failed' end,
          version = next_version,
          draft_claimed_at = null,
          draft_restore_status = null,
          failure_code = p_failure_code,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'status', case when restored then 'draft_ready' else 'failed' end,
    'version', next_version,
    'contentPreserved', restored
  );
end;
$$;

create or replace function public.qa_approve_answer(
  p_question_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  answer_row public.qa_answers%rowtype;
  revision_id uuid;
  revision_number integer;
  corpus_id uuid;
  source_id uuid;
  normalized_body text;
  content_hash text;
  promoted_body text;
  promoted_content_hash text;
  next_version integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_record where admin_record.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;

  if question_row.status = 'approved' then
    select published.revision_id into revision_id
      from public.qa_published_answers as published
     where published.question_id = question_row.id;
    if revision_id is null or not exists (
      select 1
        from public.qa_sources as source_row
       where source_row.answer_revision_id = revision_id
         and source_row.source_kind = 'published_answer'
         and source_row.active
    ) then
      raise exception using errcode = 'P0001', message = 'QA_CORPUS_PROMOTION_MISSING';
    end if;
    return pg_catalog.jsonb_build_object(
      'questionId', question_row.id,
      'revisionId', revision_id,
      'status', 'approved',
      'version', question_row.version,
      'idempotent', true
    );
  end if;
  if question_row.status <> 'draft_ready' then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  select answer.* into answer_row
    from public.qa_answers as answer
   where answer.question_id = question_row.id
   for update;
  if not found or answer_row.status <> 'draft_ready'
     or pg_catalog.char_length(pg_catalog.btrim(answer_row.working_body)) = 0
     or answer_row.promotion_content_hash is null then
    raise exception using errcode = 'P0001', message = 'QA_ANSWER_STATE_MISMATCH';
  end if;

  normalized_body := pg_catalog.btrim(answer_row.working_body);
  content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(normalized_body, 'UTF8'), 'sha256'),
    'hex'
  );
  if answer_row.promotion_content_hash <> content_hash then
    raise exception using errcode = 'P0001', message = 'QA_ANSWER_HASH_MISMATCH';
  end if;
  promoted_body := 'Question: ' || pg_catalog.btrim(question_row.question)
    || E'\nAnswer: ' || normalized_body;
  promoted_content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(promoted_body, 'UTF8'), 'sha256'),
    'hex'
  );

  select coalesce(pg_catalog.max(revision.revision_number), 0) + 1
    into revision_number
    from public.qa_revisions as revision
   where revision.answer_id = answer_row.id;

  insert into public.qa_revisions (
    answer_id, question_id, revision_number, body, created_by
  ) values (
    answer_row.id, question_row.id, revision_number, normalized_body, actor_id
  ) returning id into revision_id;

  select corpus.id into corpus_id
    from public.qa_corpus_versions as corpus
   where corpus.version_key = 'v1'
     and corpus.embedding_model = 'text-embedding-3-small'
     and corpus.embedding_dimension = 1536
   for update;
  if corpus_id is null then
    raise exception using errcode = 'P0001', message = 'QA_APPROVED_CORPUS_REQUIRED';
  end if;

  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'on', true);
  update public.qa_sources as source_row
     set active = false
    from public.qa_revisions as prior_revision
   where source_row.answer_revision_id = prior_revision.id
     and prior_revision.answer_id = answer_row.id
     and source_row.source_kind = 'published_answer'
     and source_row.active;

  insert into public.qa_sources (
    corpus_version_id,
    source_kind,
    title,
    public_url,
    storage_path,
    content_hash,
    answer_revision_id,
    active
  ) values (
    corpus_id,
    'published_answer',
    case when question_row.lang = 'en' then 'Approved Q&A' else '승인된 Q&A' end,
    null,
    null,
    promoted_content_hash,
    revision_id,
    true
  ) returning id into source_id;

  insert into public.qa_chunks (
    source_id,
    corpus_version_id,
    chunk_index,
    body,
    content_hash,
    embedding
  ) values (
    source_id,
    corpus_id,
    0,
    promoted_body,
    promoted_content_hash,
    null
  );

  insert into public.qa_published_answers (question_id, revision_id, body, lang, published_at)
  values (
    question_row.id,
    revision_id,
    normalized_body,
    question_row.lang,
    pg_catalog.clock_timestamp()
  )
  on conflict (question_id) do update
     set revision_id = excluded.revision_id,
         body = excluded.body,
         lang = excluded.lang,
         published_at = excluded.published_at;

  delete from public.qa_published_citations as published_citation
   where published_citation.question_id = question_row.id;
  insert into public.qa_published_citations (
    question_id, revision_id, ordinal, source_title, source_url, excerpt
  )
  select question_row.id,
         revision_id,
         citation.ordinal,
         source_row.title,
         source_row.public_url,
         citation.excerpt
    from public.qa_citations as citation
    join public.qa_chunks as chunk_row on chunk_row.id = citation.chunk_id
    join public.qa_sources as source_row on source_row.id = chunk_row.source_id
   where citation.answer_id = answer_row.id
     and pg_catalog.strpos(
       answer_row.working_body,
       '[' || (citation.ordinal + 1)::text || ']'
     ) > 0
   order by citation.ordinal;

  update public.qa_answers as answer
     set status = 'approved',
         working_body = normalized_body,
         promotion_content_hash = content_hash,
         updated_by = actor_id,
         updated_at = pg_catalog.clock_timestamp()
   where answer.id = answer_row.id;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = 'approved',
          version = next_version,
          draft_claimed_at = null,
          failure_code = null,
         rejection_reason = null,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'revisionId', revision_id,
    'status', 'approved',
    'version', next_version,
    'idempotent', false
  );
end;
$$;

create or replace function public.qa_reopen_answer(
  p_question_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  next_version integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status <> 'approved' then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  update public.qa_answers as answer
     set status = 'draft_ready',
         updated_by = actor_id,
         updated_at = pg_catalog.clock_timestamp()
   where answer.question_id = question_row.id
     and answer.status = 'approved';

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = 'draft_ready',
          version = next_version,
          draft_claimed_at = null,
          updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'status', 'draft_ready',
    'version', next_version
  );
end;
$$;

create or replace function public.qa_reject_question(
  p_question_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  question_row public.qa_questions%rowtype;
  next_version integer;
  clean_reason text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'QA_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'QA_ADMIN_REQUIRED';
  end if;
  if p_question_id is null or p_expected_version is null then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;
  clean_reason := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500);
  if pg_catalog.char_length(clean_reason) = 0 then
    raise exception using errcode = '22023', message = 'QA_REJECTION_REASON_REQUIRED';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;
  if question_row.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'QA_STALE_VERSION';
  end if;
  if question_row.status not in ('submitted', 'failed', 'draft_ready') then
    raise exception using errcode = 'P0001', message = 'QA_INVALID_TRANSITION';
  end if;

  next_version := question_row.version + 1;
  update public.qa_questions as q
     set status = 'rejected',
          version = next_version,
          draft_claimed_at = null,
          rejection_reason = clean_reason,
         updated_at = pg_catalog.clock_timestamp()
   where q.id = question_row.id;

  return pg_catalog.jsonb_build_object(
    'questionId', question_row.id,
    'status', 'rejected',
    'version', next_version
  );
end;
$$;

create or replace function public.qa_is_admin(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'QA_SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null then
    return false;
  end if;
  return exists (
    select 1 from public.qa_admins as admin_row where admin_row.user_id = p_user_id
  );
end;
$$;

create or replace function public.qa_evidence_gate(
  p_question_id uuid,
  p_min_rank double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  question_row public.qa_questions%rowtype;
  query_terms pg_catalog.tsquery;
  best_rank real := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'QA_SERVICE_ROLE_REQUIRED';
  end if;
  if p_question_id is null or p_min_rank is null or p_min_rank <= 0 or p_min_rank > 100 then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select q.* into question_row
    from public.qa_questions as q
   where q.id = p_question_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;

  query_terms := pg_catalog.websearch_to_tsquery(
    'pg_catalog.simple'::pg_catalog.regconfig,
    question_row.question
  );
  select coalesce(pg_catalog.max(pg_catalog.ts_rank_cd(chunk_row.search_vector, query_terms)), 0)
    into best_rank
    from public.qa_chunks as chunk_row
    join public.qa_sources as source_row on source_row.id = chunk_row.source_id
    join public.qa_corpus_versions as corpus_row
      on corpus_row.id = chunk_row.corpus_version_id
     and corpus_row.id = source_row.corpus_version_id
   where corpus_row.version_key = 'v1'
     and corpus_row.embedding_model = 'text-embedding-3-small'
     and corpus_row.embedding_dimension = 1536
     and source_row.active
     and chunk_row.search_vector @@ query_terms;

  return pg_catalog.jsonb_build_object(
    'passed', best_rank >= p_min_rank,
    'bestRank', best_rank,
    'questionId', question_row.id,
    'question', question_row.question,
    'lang', question_row.lang,
    'status', question_row.status,
    'version', question_row.version
  );
end;
$$;

create or replace function public.qa_retrieve_evidence(
  p_question_id uuid,
  p_query_embedding extensions.vector(1536),
  p_top_k integer
)
returns table (
  chunk_id uuid,
  source_title text,
  source_url text,
  body text,
  cosine_distance double precision
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  question_text text;
  query_terms pg_catalog.tsquery;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'QA_SERVICE_ROLE_REQUIRED';
  end if;
  if p_question_id is null or p_query_embedding is null or p_top_k not between 1 and 12 then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;
  select question_row.question into question_text
    from public.qa_questions as question_row
   where question_row.id = p_question_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_QUESTION_NOT_FOUND';
  end if;

  query_terms := pg_catalog.websearch_to_tsquery(
    'pg_catalog.simple'::pg_catalog.regconfig,
    question_text
  );

  return query
  with eligible as (
    select chunk_row.id,
           source_row.title,
           source_row.public_url,
           chunk_row.body,
           chunk_row.search_vector,
           chunk_row.embedding
      from public.qa_chunks as chunk_row
      join public.qa_sources as source_row on source_row.id = chunk_row.source_id
      join public.qa_corpus_versions as corpus_row
        on corpus_row.id = chunk_row.corpus_version_id
       and corpus_row.id = source_row.corpus_version_id
      where corpus_row.version_key = 'v1'
        and corpus_row.embedding_model = 'text-embedding-3-small'
        and corpus_row.embedding_dimension = 1536
        and source_row.active
  ),
  fts_matches as (
    select eligible.id,
           eligible.title,
           eligible.public_url,
           eligible.body,
           pg_catalog.row_number() over (
             order by pg_catalog.ts_rank_cd(eligible.search_vector, query_terms) desc, eligible.id
           ) as retrieval_order
      from eligible
     where eligible.search_vector @@ query_terms
     order by pg_catalog.ts_rank_cd(eligible.search_vector, query_terms) desc, eligible.id
     limit p_top_k
  ),
  vector_matches as (
    select eligible.id,
           eligible.title,
           eligible.public_url,
           eligible.body,
           (
             eligible.embedding OPERATOR(extensions.<=>) p_query_embedding
           )::double precision as distance,
           pg_catalog.row_number() over (
             order by eligible.embedding OPERATOR(extensions.<=>) p_query_embedding, eligible.id
           ) as retrieval_order
      from eligible
     where eligible.embedding is not null
       and not exists (
         select 1 from fts_matches where fts_matches.id = eligible.id
       )
     order by eligible.embedding OPERATOR(extensions.<=>) p_query_embedding, eligible.id
     limit (
       select greatest(p_top_k - pg_catalog.count(*)::integer, 0)
         from fts_matches
     )
  ),
  combined as (
    select fts_matches.id,
           fts_matches.title,
           fts_matches.public_url,
           fts_matches.body,
           null::double precision as distance,
           0 as retrieval_phase,
           fts_matches.retrieval_order
      from fts_matches
    union all
    select vector_matches.id,
           vector_matches.title,
           vector_matches.public_url,
           vector_matches.body,
           vector_matches.distance,
           1 as retrieval_phase,
           vector_matches.retrieval_order
      from vector_matches
  )
  select combined.id,
         combined.title,
         combined.public_url,
         combined.body,
         combined.distance
    from combined
   order by combined.retrieval_phase, combined.retrieval_order, combined.id
   limit p_top_k;
end;
$$;

drop function if exists public.qa_backfill_approved_chunk_embedding(uuid, text, extensions.vector);
create or replace function public.qa_backfill_approved_chunk_embedding(
  p_chunk_id uuid,
  p_expected_content_hash text,
  p_embedding extensions.vector(1536)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chunk_body text;
  chunk_content_hash text;
  source_content_hash text;
  source_kind text;
  corpus_version_key text;
  corpus_embedding_model text;
  corpus_embedding_dimension integer;
  existing_embedding extensions.vector(1536);
  calculated_content_hash text;
  updated_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'QA_SERVICE_ROLE_REQUIRED';
  end if;
  if p_chunk_id is null
     or p_embedding is null
     or p_expected_content_hash is null
     or p_expected_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'QA_INVALID_ARGUMENT';
  end if;

  select chunk_row.body,
         chunk_row.content_hash,
         chunk_row.embedding,
         source_row.content_hash,
         source_row.source_kind,
         corpus_row.version_key,
         corpus_row.embedding_model,
         corpus_row.embedding_dimension
    into chunk_body,
         chunk_content_hash,
         existing_embedding,
         source_content_hash,
         source_kind,
         corpus_version_key,
         corpus_embedding_model,
         corpus_embedding_dimension
    from public.qa_chunks as chunk_row
    join public.qa_sources as source_row on source_row.id = chunk_row.source_id
    join public.qa_corpus_versions as corpus_row
      on corpus_row.id = chunk_row.corpus_version_id
     and corpus_row.id = source_row.corpus_version_id
   where chunk_row.id = p_chunk_id
   for update of chunk_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'QA_CHUNK_NOT_FOUND';
  end if;

  calculated_content_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(chunk_body, 'UTF8'), 'sha256'),
    'hex'
  );
  if source_kind <> 'published_answer'
     or corpus_version_key <> 'v1'
     or corpus_embedding_model <> 'text-embedding-3-small'
     or corpus_embedding_dimension <> 1536
     or chunk_content_hash <> p_expected_content_hash
     or source_content_hash <> p_expected_content_hash
     or calculated_content_hash <> p_expected_content_hash
     or existing_embedding is not null then
    raise exception using errcode = 'P0001', message = 'QA_BACKFILL_PRECONDITION_FAILED';
  end if;

  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'on', true);
  update public.qa_chunks as chunk_row
     set embedding = p_embedding
   where chunk_row.id = p_chunk_id
     and chunk_row.content_hash = p_expected_content_hash
     and chunk_row.embedding is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception using errcode = '40001', message = 'QA_BACKFILL_STALE';
  end if;

  return pg_catalog.jsonb_build_object(
    'chunkId', p_chunk_id,
    'contentHash', p_expected_content_hash,
    'embeddingBackfilled', true
  );
end;
$$;

-- Legacy overload tied every import to a changing whole-dataset hash. Imports now bind only to
-- the fixed v1 retrieval contract and use each immutable source hash for idempotency.
drop function if exists public.qa_import_approved_source(text, text, text, text, text, jsonb);
drop function if exists public.qa_import_approved_source(text, text, text, text, jsonb);
create or replace function public.qa_import_approved_source(
  p_title text,
  p_public_url text,
  p_storage_path text,
  p_source_hash text,
  p_embedding_model text,
  p_chunks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  corpus_id uuid;
  source_id uuid;
  chunk_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'QA_SERVICE_ROLE_REQUIRED';
  end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 500
     or p_storage_path is null or pg_catalog.char_length(pg_catalog.btrim(p_storage_path)) = 0
     or p_storage_path ~ '(^|/)\.\.(/|$)'
     or p_source_hash is null
     or p_source_hash !~ '^[0-9a-f]{64}$'
     or pg_catalog.btrim(p_storage_path) <> 'v1/sources/' || p_source_hash || '.json'
     or p_embedding_model is null
     or p_embedding_model <> 'text-embedding-3-small'
     or (p_public_url is not null and p_public_url !~ '^https://')
     or pg_catalog.jsonb_typeof(p_chunks) <> 'array' then
    raise exception using errcode = '22023', message = 'QA_INVALID_IMPORT';
  end if;

  chunk_count := pg_catalog.jsonb_array_length(p_chunks);
  if chunk_count < 1 or chunk_count > 10000 then
    raise exception using errcode = '22023', message = 'QA_INVALID_IMPORT';
  end if;
  if exists (
    select 1
      from pg_catalog.jsonb_array_elements(p_chunks) as chunk(value)
     where pg_catalog.jsonb_typeof(chunk.value) <> 'object'
         or pg_catalog.char_length(pg_catalog.btrim(coalesce(chunk.value ->> 'body', ''))) not between 1 and 12000
         or coalesce(chunk.value ->> 'contentHash', '') !~ '^[0-9a-f]{64}$'
         or coalesce(chunk.value ->> 'contentHash', '') <> pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(pg_catalog.btrim(chunk.value ->> 'body'), 'UTF8'),
             'sha256'
           ),
           'hex'
         )
         or case
           when pg_catalog.jsonb_typeof(chunk.value -> 'embedding') = 'array' then
             pg_catalog.jsonb_array_length(chunk.value -> 'embedding') <> 1536
             or exists (
               select 1
                 from pg_catalog.jsonb_array_elements(chunk.value -> 'embedding') as embedding_value(value)
                where pg_catalog.jsonb_typeof(embedding_value.value) <> 'number'
             )
           else true
         end
  ) then
    raise exception using errcode = '22023', message = 'QA_INVALID_IMPORT_CHUNK';
  end if;

  select corpus.id into corpus_id
    from public.qa_corpus_versions as corpus
   where corpus.version_key = 'v1'
     and corpus.embedding_model = p_embedding_model
     and corpus.embedding_dimension = 1536;
  if corpus_id is null then
    raise exception using errcode = 'P0001', message = 'QA_CORPUS_CONTRACT_REQUIRED';
  end if;

  select source.id into source_id
    from public.qa_sources as source
   where source.content_hash = p_source_hash
     and source.source_kind <> 'published_answer';
  if source_id is not null then
    return source_id;
  end if;

  perform pg_catalog.set_config('edabible.qa_corpus_mutation', 'on', true);
  insert into public.qa_sources (
    corpus_version_id, source_kind, title, public_url, storage_path, content_hash
  ) values (
    corpus_id,
    'historical_qa',
    pg_catalog.btrim(p_title),
    p_public_url,
    pg_catalog.btrim(p_storage_path),
    p_source_hash
  )
  on conflict (content_hash) where source_kind <> 'published_answer' do nothing
  returning id into source_id;

  if source_id is null then
    select source.id into source_id
      from public.qa_sources as source
     where source.content_hash = p_source_hash
       and source.source_kind <> 'published_answer';
    return source_id;
  end if;

  insert into public.qa_chunks (
    source_id, corpus_version_id, chunk_index, body, content_hash, embedding
  )
  select source_id,
         corpus_id,
         (chunk.ordinality - 1)::integer,
         pg_catalog.btrim(chunk.value ->> 'body'),
         chunk.value ->> 'contentHash',
         (chunk.value -> 'embedding')::text::extensions.vector(1536)
    from pg_catalog.jsonb_array_elements(p_chunks) with ordinality as chunk(value, ordinality)
   order by chunk.ordinality;

  return source_id;
end;
$$;

revoke all on function public.qa_guard_approved_corpus() from public, anon, authenticated;
revoke all on function public.qa_submit_question(text, text, uuid) from public, anon, authenticated;
revoke all on function public.qa_claim_draft(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.qa_complete_insufficient_draft(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.qa_complete_draft(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.qa_update_working_answer(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.qa_fail_draft(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.qa_approve_answer(uuid, integer) from public, anon, authenticated;
revoke all on function public.qa_reopen_answer(uuid, integer) from public, anon, authenticated;
revoke all on function public.qa_reject_question(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.qa_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.qa_evidence_gate(uuid, double precision) from public, anon, authenticated;
revoke all on function public.qa_retrieve_evidence(uuid, extensions.vector, integer) from public, anon, authenticated;
revoke all on function public.qa_backfill_approved_chunk_embedding(uuid, text, extensions.vector) from public, anon, authenticated;
revoke all on function public.qa_import_approved_source(text, text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.qa_submit_question(text, text, uuid) to authenticated;
grant execute on function public.qa_claim_draft(uuid, integer, boolean) to authenticated;
grant execute on function public.qa_complete_insufficient_draft(uuid, integer, boolean) to authenticated;
grant execute on function public.qa_complete_draft(uuid, integer, text, jsonb) to authenticated;
grant execute on function public.qa_update_working_answer(uuid, integer, text) to authenticated;
grant execute on function public.qa_fail_draft(uuid, integer, text) to authenticated;
grant execute on function public.qa_approve_answer(uuid, integer) to authenticated;
grant execute on function public.qa_reopen_answer(uuid, integer) to authenticated;
grant execute on function public.qa_reject_question(uuid, integer, text) to authenticated;
grant execute on function public.qa_is_admin(uuid) to service_role;
grant execute on function public.qa_evidence_gate(uuid, double precision) to service_role;
grant execute on function public.qa_retrieve_evidence(uuid, extensions.vector, integer) to service_role;
grant execute on function public.qa_backfill_approved_chunk_embedding(uuid, text, extensions.vector) to service_role;
grant execute on function public.qa_import_approved_source(text, text, text, text, text, jsonb) to service_role;

-- Q&A 원본은 private bucket에만 둔다. 이 app-owned RESTRICTIVE policy는 다른 bucket의
-- permissive policy를 건드리지 않고 qa-sources에 대한 anon/authenticated 접근만 차단한다.
insert into storage.buckets (id, name, public)
values ('qa-sources', 'qa-sources', false)
on conflict (id) do update set public = false;

drop policy if exists "qa_sources_deny_client_operations" on storage.objects;
create policy "qa_sources_deny_client_operations"
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id <> 'qa-sources')
with check (bucket_id <> 'qa-sources');

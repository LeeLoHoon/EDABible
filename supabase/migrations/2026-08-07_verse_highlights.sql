-- 형광펜: 성경 본문 귀속 · 묵상/설교 공유 · 역본×장 단위
-- supabase/schema.sql 의 형광펜 블록(708~859행)을 그대로 뽑은 것이라 재실행해도 안전하다.
-- Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 Run 하면 된다.

-- ---------------------------------------------------------------------------
-- 형광펜: 묵상 한 편이 아니라 성경 본문에 귀속된다. 어느 묵상에서 긋든 같은 구절이면
-- 같은 밑줄이 보이고, 설교 묵상과도 공유된다. 저장 단위는 역본 × 장이다 —
-- msg/gae/sae는 본문 자체가 달라 문자 오프셋(start/end)이 호환되지 않는다.
-- ---------------------------------------------------------------------------

create table if not exists public.verse_highlights (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- msg/gae/sae는 한국어 역본, en은 영어 본문. 본문이 다르면 문자 오프셋도 다르므로 나눈다.
  version text not null check (version in ('msg', 'gae', 'sae', 'en')),
  book_order integer not null check (book_order between 1 and 66),
  chapter integer not null check (chapter >= 1),
  -- [{key, start, end, color}] — key는 장 안에서의 절 라벨('12') 또는 문단 순번('p0')
  ranges jsonb not null default '[]',
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, version, book_order, chapter)
);

create index if not exists verse_highlights_owner_updated_idx
  on public.verse_highlights (user_id, updated_at desc);

alter table public.verse_highlights enable row level security;

drop policy if exists "users read own verse highlights" on public.verse_highlights;
create policy "users read own verse highlights"
on public.verse_highlights for select
to authenticated
using (auth.uid() = user_id);

-- 쓰기는 expected-revision RPC로만 — 밑줄 전체를 통째로 덮는 구조라 stale client가
-- 다른 기기에서 방금 그은 밑줄을 지워 버릴 수 있다.
revoke insert, update, delete on table public.verse_highlights from public, anon, authenticated;
grant select on table public.verse_highlights to authenticated;

create or replace function public.put_verse_highlights(
  p_owner_user_id uuid,
  p_version text,
  p_book_order integer,
  p_chapter integer,
  p_expected_revision integer,
  p_ranges jsonb
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
    raise exception using errcode = '42501', message = 'VERSE_HIGHLIGHT_AUTH_REQUIRED';
  end if;
  if p_owner_user_id is null or p_owner_user_id <> actor_id then
    raise exception using errcode = '42501', message = 'VERSE_HIGHLIGHT_OWNER_MISMATCH';
  end if;
  if p_version is null
     or p_version not in ('msg', 'gae', 'sae', 'en')
     or p_book_order is null
     or p_book_order < 1
     or p_book_order > 66
     or p_chapter is null
     or p_chapter < 1
     or p_expected_revision is null
     or p_expected_revision < 0
     or pg_catalog.jsonb_typeof(p_ranges) <> 'array' then
    raise exception using errcode = '22023', message = 'VERSE_HIGHLIGHT_INVALID_ARGUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      actor_id::text || ':' || p_version || ':' || p_book_order::text || ':' || p_chapter::text,
      27072026
    )
  );

  select highlight.revision
    into current_revision
    from public.verse_highlights as highlight
   where highlight.user_id = actor_id
     and highlight.version = p_version
     and highlight.book_order = p_book_order
     and highlight.chapter = p_chapter
   for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'VERSE_HIGHLIGHT_STALE_REVISION';
    end if;
    insert into public.verse_highlights
      (user_id, version, book_order, chapter, ranges, revision, updated_at)
    values (actor_id, p_version, p_book_order, p_chapter, p_ranges, 1, saved_at);
    next_revision := 1;
  else
    if current_revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'VERSE_HIGHLIGHT_STALE_REVISION';
    end if;
    next_revision := current_revision + 1;
    update public.verse_highlights as highlight
       set ranges = p_ranges,
           revision = next_revision,
           updated_at = saved_at
     where highlight.user_id = actor_id
       and highlight.version = p_version
       and highlight.book_order = p_book_order
       and highlight.chapter = p_chapter;
  end if;

  return pg_catalog.jsonb_build_object(
    'bookOrder', p_book_order,
    'chapter', p_chapter,
    'revision', next_revision,
    'updatedAt', saved_at
  );
end;
$$;

revoke all on function public.put_verse_highlights(uuid, text, integer, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.put_verse_highlights(uuid, text, integer, integer, integer, jsonb)
  to authenticated;

-- 동기화용 메타. ranges는 반환하지 않는다 — 뒤처진 장만 골라 따로 받아 온다.
create or replace function public.list_my_verse_highlights()
returns table (
  version text,
  book_order integer,
  chapter integer,
  revision integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select highlight.version,
         highlight.book_order,
         highlight.chapter,
         highlight.revision,
         highlight.updated_at
    from public.verse_highlights as highlight
   where highlight.user_id = auth.uid()
   order by highlight.updated_at desc
$$;

revoke all on function public.list_my_verse_highlights() from public, anon;
grant execute on function public.list_my_verse_highlights() to authenticated;

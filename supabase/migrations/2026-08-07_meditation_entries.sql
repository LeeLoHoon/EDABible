-- 말씀 묵상 노트: 계정 단위 보관 · 기기 간 동기화
-- supabase/schema.sql 의 묵상 노트 블록(521~706행)을 그대로 뽑은 것이라 재실행해도 안전하다.
-- Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 Run 하면 된다.

-- ---------------------------------------------------------------------------
-- 말씀 묵상 노트: 형광펜·필사·답변·기도를 계정 단위로 보관해 기기를 바꿔도 이어 쓴다.
-- 설교 노트와 달리 관리자 열람 통로는 열지 않는다 — 개인 묵상이다.
-- ---------------------------------------------------------------------------

create table if not exists public.meditation_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  data jsonb not null,
  revision integer not null default 1 check (revision >= 1),
  -- tombstone. 지운 묵상도 행을 남겨야 다른 기기가 "서버에 없음(= 방금 만든 것)"과
  -- "지워진 것"을 구분할 수 있다. 본문은 비우고 삭제 시각만 남긴다.
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, entry_id)
);

create index if not exists meditation_entries_owner_updated_idx
  on public.meditation_entries (user_id, updated_at desc);

alter table public.meditation_entries enable row level security;

drop policy if exists "users read own meditation entries" on public.meditation_entries;
create policy "users read own meditation entries"
on public.meditation_entries for select
to authenticated
using (auth.uid() = user_id);

-- 쓰기는 아래 expected-revision RPC로만 허용해 stale client overwrite를 막는다.
-- 삭제도 RPC로만 — 직접 delete를 열면 tombstone 없이 행이 사라져 삭제가 전파되지 않는다.
revoke insert, update, delete on table public.meditation_entries from public, anon, authenticated;
grant select on table public.meditation_entries to authenticated;

create or replace function public.put_meditation_entry(
  p_owner_user_id uuid,
  p_entry_id uuid,
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
  current_deleted_at timestamptz;
  next_revision integer;
  saved_at timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'MEDITATION_ENTRY_AUTH_REQUIRED';
  end if;
  if p_owner_user_id is null or p_owner_user_id <> actor_id then
    raise exception using errcode = '42501', message = 'MEDITATION_ENTRY_OWNER_MISMATCH';
  end if;
  if p_entry_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or pg_catalog.jsonb_typeof(p_data) <> 'object'
     or coalesce(p_data ->> 'id', '') <> p_entry_id::text then
    raise exception using errcode = '22023', message = 'MEDITATION_ENTRY_INVALID_ARGUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_entry_id::text, 27072026)
  );

  select entry.revision, entry.deleted_at
    into current_revision, current_deleted_at
    from public.meditation_entries as entry
   where entry.user_id = actor_id
     and entry.entry_id = p_entry_id
   for update;

  if not found then
    if p_expected_revision <> 0 then
      raise exception using errcode = 'P0001', message = 'MEDITATION_ENTRY_STALE_REVISION';
    end if;
    insert into public.meditation_entries (user_id, entry_id, data, revision, updated_at)
    values (actor_id, p_entry_id, p_data, 1, saved_at);
    next_revision := 1;
  else
    -- 지운 묵상은 되살리지 않는다. 다른 기기의 삭제가 뒤늦게 도착한 편집으로 뒤집히면
    -- "지웠는데 되살아난다"가 된다.
    if current_deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'MEDITATION_ENTRY_DELETED';
    end if;
    if current_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'MEDITATION_ENTRY_STALE_REVISION';
    end if;
    next_revision := current_revision + 1;
    update public.meditation_entries as entry
       set data = p_data,
           revision = next_revision,
           updated_at = saved_at
     where entry.user_id = actor_id
       and entry.entry_id = p_entry_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'entryId', p_entry_id,
    'revision', next_revision,
    'updatedAt', saved_at
  );
end;
$$;

revoke all on function public.put_meditation_entry(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.put_meditation_entry(uuid, uuid, integer, jsonb) to authenticated;

-- 삭제는 tombstone으로 남기되 본문은 비운다 — 지운 묵상의 내용을 서버에 남겨두지 않는다.
create or replace function public.delete_meditation_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_revision integer;
  deleted_time timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'MEDITATION_ENTRY_AUTH_REQUIRED';
  end if;
  if p_entry_id is null then
    raise exception using errcode = '22023', message = 'MEDITATION_ENTRY_INVALID_ARGUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_id::text || ':' || p_entry_id::text, 27072026)
  );

  update public.meditation_entries as entry
     set data = '{}'::jsonb,
         revision = entry.revision + 1,
         deleted_at = coalesce(entry.deleted_at, deleted_time),
         updated_at = deleted_time
   where entry.user_id = actor_id
     and entry.entry_id = p_entry_id
  returning entry.revision into next_revision;

  -- 아직 한 번도 올라간 적 없는 묵상을 지운 경우 — tombstone을 새로 세워 두어야
  -- 다른 기기의 대기 중인 편집이 뒤늦게 올라와 되살아나지 않는다.
  if not found then
    insert into public.meditation_entries (user_id, entry_id, data, revision, deleted_at, updated_at)
    values (actor_id, p_entry_id, '{}'::jsonb, 1, deleted_time, deleted_time);
    next_revision := 1;
  end if;

  return pg_catalog.jsonb_build_object(
    'entryId', p_entry_id,
    'revision', next_revision,
    'deletedAt', deleted_time
  );
end;
$$;

revoke all on function public.delete_meditation_entry(uuid) from public, anon, authenticated;
grant execute on function public.delete_meditation_entry(uuid) to authenticated;

-- 목록·동기화용 메타. data는 반환하지 않는다 — 손글씨 획까지 담긴 본문을 목록에서
-- 통째로 내려받으면 수 MB가 되므로, 본문은 실제로 받아야 할 행만 개별 조회한다.
create or replace function public.list_my_meditation_entries()
returns table (
  entry_id uuid,
  revision integer,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select entry.entry_id, entry.revision, entry.updated_at, entry.deleted_at
    from public.meditation_entries as entry
   where entry.user_id = auth.uid()
   order by entry.updated_at desc
$$;

revoke all on function public.list_my_meditation_entries() from public, anon;
grant execute on function public.list_my_meditation_entries() to authenticated;

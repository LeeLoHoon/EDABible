-- 주간 말씀 묵상: 계정 보관 · 아카이브 · 관리자 열람
-- supabase/schema.sql 의 설교 블록(204~519행)을 그대로 뽑은 것이라 재실행해도 안전하다.
-- Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 Run 하면 된다.

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
-- 게시 취소된 설교라도 내 묵상이 달려 있으면 계속 읽을 수 있어야 한다 —
-- 관리자가 설교를 내렸다고 교인의 지난 묵상까지 잠기면 보관이 아니다.
drop policy if exists "read published sermons" on public.sermons;
create policy "read published sermons"
on public.sermons for select
to anon, authenticated
using (
  published
  or auth.uid() in (select user_id from public.sermon_admins)
  or exists (
    select 1
      from public.sermon_notes as note
     where note.sermon_id = sermons.id
       and note.user_id = auth.uid()
  )
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

-- 묵상은 본인이 읽고 쓴다. 여기에 더해 sermon_admins에 등록된 관리자(목사님·전도사님)가
-- 교인의 묵상을 열람할 수 있다 — 삭제 전 영향 확인과 심방·양육을 위해 열어 둔 통로다.
-- 쓰기는 여전히 본인만 가능하다(put_sermon_note가 actor_id로 강제).
drop policy if exists "users read own sermon notes" on public.sermon_notes;
create policy "users read own sermon notes"
on public.sermon_notes for select
to authenticated
using (
  auth.uid() = user_id
  or auth.uid() in (select user_id from public.sermon_admins)
);

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
      raise exception using errcode = 'P0001', message = 'SERMON_NOTE_STALE_REVISION';
    end if;
    insert into public.sermon_notes (user_id, sermon_id, data, revision, updated_at)
    values (actor_id, p_sermon_id, p_data, 1, saved_at);
    next_revision := 1;
  else
    if current_revision <> p_expected_revision then
      raise exception using errcode = 'P0001', message = 'SERMON_NOTE_STALE_REVISION';
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

-- 묵상 한 칸(Field: {mode, text, strokes})이 실제로 채워졌는지 — types.ts의 isFieldEmpty와 같은 규칙
create or replace function public.sermon_field_written(p_field jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(coalesce(p_field ->> 'text', '')) <> ''
      or pg_catalog.jsonb_array_length(coalesce(p_field -> 'strokes', '[]'::jsonb)) > 0
$$;

-- 묵상 아카이브 목록. data jsonb 전체를 내리면 무거워서 화면에 필요한 지표만 서버에서 계산한다.
-- security invoker라 RLS가 그대로 적용된다 — 본인 묵상만 나온다.
create or replace function public.list_my_sermon_notes()
returns table (
  sermon_id uuid,
  preached_on date,
  service text,
  title text,
  title_en text,
  passages jsonb,
  note_updated_at timestamptz,
  revision integer,
  highlight_count integer,
  answered_points integer,
  written_fields integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    note.sermon_id,
    sermon.preached_on,
    sermon.service,
    sermon.title,
    sermon.title_en,
    sermon.passages,
    note.updated_at,
    note.revision,
    (
      pg_catalog.jsonb_array_length(coalesce(note.data -> 'highlightRanges', '[]'::jsonb))
      + coalesce(
          (
            select pg_catalog.sum(pg_catalog.jsonb_array_length(version.value))
              from pg_catalog.jsonb_each(coalesce(note.data -> 'highlightVersions', '{}'::jsonb)) as version
          ),
          0
        )
    )::integer as highlight_count,
    (
      select pg_catalog.count(*)
        from pg_catalog.jsonb_array_elements(coalesce(note.data -> 'pointAnswers', '[]'::jsonb)) as answer
       where public.sermon_field_written(answer.value)
    )::integer as answered_points,
    (
      (case when public.sermon_field_written(note.data -> 'impression') then 1 else 0 end)
      + (case when public.sermon_field_written(note.data -> 'application') then 1 else 0 end)
      + (case when public.sermon_field_written(note.data -> 'freeNote') then 1 else 0 end)
    )::integer as written_fields
  from public.sermon_notes as note
  join public.sermons as sermon on sermon.id = note.sermon_id
 where note.user_id = auth.uid()
 order by sermon.preached_on desc, sermon.service asc
$$;

revoke all on function public.list_my_sermon_notes() from public, anon;
grant execute on function public.list_my_sermon_notes() to authenticated;

-- 설교 삭제 전 영향 확인용 — 그 설교에 달린 묵상이 몇 개인지 관리자에게 보여준다.
-- sermon_notes는 RLS로 본인 것만 보이므로, 전체 개수는 이 함수(definer)로만 셀 수 있다.
create or replace function public.count_sermon_notes(p_sermon_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if auth.uid() is null
     or auth.uid() not in (select admin.user_id from public.sermon_admins as admin) then
    raise exception using errcode = '42501', message = 'SERMON_ADMIN_REQUIRED';
  end if;

  select pg_catalog.count(*)
    into total
    from public.sermon_notes as note
   where note.sermon_id = p_sermon_id;

  return total;
end;
$$;

revoke all on function public.count_sermon_notes(uuid) from public, anon;
grant execute on function public.count_sermon_notes(uuid) to authenticated;

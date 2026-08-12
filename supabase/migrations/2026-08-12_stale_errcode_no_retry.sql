-- errcode 40001(serialization_failure)을 비즈니스 오류(STALE_REVISION 등)에 쓰면
-- PostgREST가 "일시적 충돌"로 오인해 같은 트랜잭션을 무한 재시도한다
-- (https://github.com/PostgREST/postgrest/issues/3673).
-- 실제로 2026-08-11 21:36 UTC, 폰 한 대의 stale push 하나가 초당 ~900회 재실행되며
-- 커넥션 풀과 CPU를 다 태워 프로젝트 전체 REST API가 5시간 넘게 죽었다.
-- 모든 raise를 재시도 대상이 아닌 P0001(raise_exception)로 바꾼다.
-- 클라이언트는 에러 메시지 문자열로 분기하므로 동작 변화 없음.
--
-- Supabase Dashboard → SQL Editor 에 통째로 붙여넣고 Run 하면 된다. 재실행해도 안전하다.

do $fix$
declare
  fn record;
  def text;
  changed int := 0;
begin
  for fn in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc like '%''40001''%'
  loop
    def := pg_get_functiondef(fn.oid);
    def := replace(def, 'errcode = ''40001''', 'errcode = ''P0001''');
    if position('40001' in def) > 0 then
      raise exception 'unhandled 40001 pattern in %', fn.oid::regprocedure;
    end if;
    execute def;
    changed := changed + 1;
  end loop;
  raise notice 'functions updated: %', changed;
end
$fix$;

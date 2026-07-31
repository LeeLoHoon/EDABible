# EDABible

성경 묵상·필사 앱입니다.

성경 본문의 Git 원본은 `data/bible-chapters.jsonl`입니다. `public/bible/*.json`은 앱 배포용 산출물이며 `npm run build:bible`로 재생성합니다. Supabase가 설정되어 있으면 앱은 Supabase의 `bible_chapters`를 우선 읽고, 실패하면 `public/bible`과 IndexedDB 캐시를 사용합니다.

## Bible Data

```text
data/bible-books.json           # 66권 메타데이터 (한국어 역본 공용)
data/bible-chapters.jsonl       # 메시지성경(기본) 장 단위 본문 원본
data/bible-chapters.en.jsonl    # The Message 영어
data/bible-chapters.gae.jsonl   # 개역개정
data/bible-chapters.sae.jsonl   # 새번역
public/bible/*.json             # 앱 배포용 산출물 (en/, gae/, sae/ 하위 폴더 포함)
```

개역개정·새번역은 dev-dooD/bible-crawler 덤프(`scripts/import_gae_bible.mjs`, 새번역은
`--version sae`)에서 가져왔다. 두 역본 모두 대한성서공회 저작권이므로 외부 공개 배포 전에는
이용 허가를 확인해야 한다. 추가 역본은 읽기 전용이며 Supabase 편집 파이프라인은
메시지성경(`msg`)에만 적용된다. 주간 말씀 묵상 본문 화면에서 역본(메시지/개역개정/새번역)을
전환할 수 있고, 형광펜은 역본별로 따로 저장된다.

본문을 코드에서 수정할 때는 `data/bible-chapters.jsonl`을 고친 뒤 아래 명령을 실행합니다.

```bash
npm run build:bible
npm run validate:bible
```

웹에서 Supabase 본문을 수정한 뒤 그 상태를 코드에 저장하려면 아래 명령을 실행합니다.

```bash
npm run pull:supabase-bible
npm run validate:bible
```

## Supabase

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
   기존 프로젝트도 같은 파일을 다시 실행하면 `is_finalized` 완료 컬럼과 완료된 장 수정 차단 policy가 추가됩니다.
2. 환경변수를 설정합니다.

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

3. 현재 `public/bible` 본문을 DB에 올립니다.

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key npm run seed:supabase-bible
```

현재 정책은 요청에 맞춰 anon 사용자도 본문을 읽고 수정할 수 있게 열려 있습니다. 운영에서 잠그려면 `supabase/schema.sql`의 update/insert policy를 인증 사용자나 관리자 조건으로 바꾸면 됩니다.

## Scripts

```bash
npm run dev           # 말씀 묵상 노트 개발 서버
npm run dev:binder    # 에다 SPL 바인더 개발 서버
npm run dev:sermon    # 주간 말씀 묵상 개발 서버
npm run dev:all       # 통합(노트+바인더) 개발 서버
npm run build:note
npm run build:binder
npm run build:sermon
npm run build:all
npm run build:bible
npm run build
npm run validate:bible
npm run seed:supabase-bible
npm run pull:supabase-bible
```

## 분리 배포

```bash
npm run build:note    # dist: 말씀 묵상 노트만 배포, public/binder 제외
npm run build:binder  # dist-binder: 에다 SPL 바인더만 배포, public/bible 제외
npm run build:sermon  # dist-sermon: 주간 말씀 묵상만 배포, public/binder 제외
npm run build:all     # dist-all: 노트·바인더·주간 묵상 통합 배포
```

Vercel 기본 배포는 `npm run build`를 사용하며 `APP_TARGET` 환경변수에 따라 대상이 정해지고
산출물은 항상 `dist`입니다(저장소 `vercel.json`이 Output Directory를 `dist`로 고정).

### 통합 배포 (현행)

노트가 쓰던 `eda-bible` 프로젝트에 `APP_TARGET=all`을 설정해 한 도메인에서 세 기능을 모두
서비스합니다. 노트 사용자의 로컬 데이터(IndexedDB)는 origin이 그대로라 보존되고, 바인더는
로그인하면 Supabase에서 복구되며, 기존 바인더·주간 묵상 단독 배포에는 새 주소 안내 배너가
표시됩니다. 통합 앱 경로: `/#/`(랜딩), `/#/note`(노트 홈), `/#/binder`, `/#/sermon`, `/#/qa`.

`.github/workflows/deploy.yml`의 GitHub Pages workflow는 `APP_TARGET` 없이 `npm run build`를
실행하는 **note-only legacy 배포**입니다. Vercel 통합 배포를 대신하지 않으며, 별도 요청 없이
workflow를 all target으로 변경하지 않습니다.

### Vercel 배포 채널 2개 구성

같은 Git 저장소를 Vercel 프로젝트 두 개에 연결합니다.

```text
edabible-note
Build Command: npm run build:note
Output Directory: dist

edabible-binder
Build Command: npm run build:binder
Output Directory: dist-binder
```

Vercel 대시보드에서 Build Command를 바꿀 수 없으면 새 바인더 프로젝트는 기본값을 그대로 둔 채 환경변수만 추가합니다.

```text
APP_TARGET=binder
Build Command: npm run build
Output Directory: dist
```

기존 말씀 묵상 노트 프로젝트에는 `APP_TARGET`을 추가하지 않습니다. 환경변수가 없으면 `npm run build`는 말씀 묵상 노트로 빌드됩니다.

CLI로 배포할 때는 아래 설정 파일을 사용할 수 있습니다.

```bash
vercel --prod --local-config vercel.note.json
vercel --prod --local-config vercel.binder.json
```

### SPL 바인더 로그인

SPL 바인더는 Google 로그인 필수입니다. Supabase에서 아래 설정이 필요합니다.

1. Supabase SQL Editor에서 `supabase/schema.sql`을 다시 실행해 `binder_works` 테이블과 RLS policy를 추가합니다.
2. Supabase Dashboard → Authentication → Providers → Google을 활성화합니다.
3. Google OAuth Client ID/Secret을 Supabase에 입력합니다.
4. Authentication → URL Configuration에 바인더 배포 주소를 Site URL 또는 Redirect URLs에 추가합니다.

바인더 필기와 책갈피는 `binder_works`에 사용자별로 저장됩니다. 기존 기기의 로컬 바인더 기록은 로그인 후 같은 권을 열고 저장 동작이 발생하면 해당 사용자 데이터로 업로드됩니다.

### SPL 바인더 관리자 등록

숨김 쪽 관리자는 클라이언트의 anon key로 등록할 수 없습니다. Supabase SQL Editor 또는 service role 연결에서 Authentication → Users에 표시된 사용자 ID를 등록합니다.

```sql
insert into public.binder_admins (user_id)
values ('<auth.users.id>')
on conflict (user_id) do nothing;
```

관리자로 로그인한 뒤 앱 제목을 2초 안에 5번 탭하면 관리자 모드가 토글됩니다. 관리자가 정한 숨김 쪽은 모든 사용자에게 공유되며, 원본 PDF와 사용자별 필기·책갈피는 삭제하거나 쪽번호를 다시 매기지 않습니다. service role key는 환경변수나 시크릿 매니저에서만 사용하고 저장소에 커밋하지 마세요.

## 주간 말씀 묵상

주일 설교(오전·오후)를 교인이 그 주 월~토에 묵상하는 별도 앱입니다. Google 로그인이 필수이고 성경 본문을 쓰므로 `public/bible`은 포함하되 `public/binder`는 제외합니다.

```text
edabible-sermon
Build Command: npm run build:sermon
Output Directory: dist-sermon
```

Vercel 대시보드에서 Build Command를 바꿀 수 없으면 환경변수만 추가합니다. 저장소의
`vercel.json`이 Output Directory를 `dist`로 고정하므로 `npm run build`는 sermon도
바인더처럼 `dist`에 생성합니다.

```text
APP_TARGET=sermon
Build Command: npm run build
Output Directory: dist
```

CLI로 배포할 때는 아래 설정 파일을 사용합니다.

```bash
vercel --prod --local-config vercel.sermon.json
```

### 주간 말씀 묵상 관리자 등록

설교 등록 관리자는 바인더 관리자와 **별개 테이블**입니다. anon key로는 등록할 수 없으므로 Supabase SQL Editor 또는 service role 연결에서 등록합니다.

```sql
insert into public.sermon_admins (user_id)
values ('<auth.users.id>')
on conflict (user_id) do nothing;
```

관리자로 로그인한 뒤 앱 제목을 2초 안에 5번 탭하면 관리자 모드가 토글되고, 헤더 우측의 `🛡 관리자 모드 종료` 버튼으로 빠져나옵니다. 관리자가 아닌 계정에서는 탭해도 아무 반응이 없습니다.

설교 본문은 **장 단위**로 저장합니다. `로마서 8:28-30` 같은 절 범위는 표기(`verseLabel`)로만 남고 화면에는 해당 장 전체가 보입니다. 성경 1189장 중 697장에 절 마커가 없어 본문을 절 단위로 잘라낼 수 없고, 잘라내면 형광펜 하이라이트 키가 어긋나기 때문입니다.

묵상은 `sermon_notes`에 사용자별로 저장되며 본인만 읽고 쓸 수 있습니다. 목사님 열람 기능을 나중에 붙일 때는 `sermon_notes`의 select policy만 확장하면 됩니다.

설교의 영어 제목·설교자·요약·포인트는 nullable입니다. 영어 내용이 아직 승인되지 않은 칸은
한국어 원문으로 fallback하며 번역문을 자동 생성하지 않습니다. 바인더의 디모데 만들기·책공부
checkpoint 제목도 `scripts/binder_checkpoint_titles.mjs`에 승인된 값이 없으면 기존 호수 label을
그대로 표시합니다. `npm run check:binder-titles`는 실제 등록 영상 제목을 후보로만 보고하며
자동 선택하지 않습니다.

## 질의응답 (admin-only AI draft)

통합 all target과 sermon target에는 모두 Q&A route가 포함됩니다. 두 배포 모두 질문 목록은
`/#/qa`, 개별 thread는 `/#/qa/<questionId>`에서 엽니다. note-only/binder target에는 Q&A route가
없습니다.

사용자는 stable client token으로 질문만 제출합니다. AI 초안은 `qa_admins`에 등록된 관리자가
명시적으로 요청할 때만 생성되고, 관리자가 검토·수정한 뒤 승인해야 사용자에게 published answer와
정제된 citation이 보입니다. Edge Function은 승인 corpus에 대한 FTS evidence gate를 먼저 통과한
경우에만 embedding/generation provider를 호출합니다. 근거가 부족하면 provider 호출 없이 고정
안내문을 editable admin draft로 저장하며, 소유자는 publish 전 draft를 읽을 수 없습니다. Q&A는
Dexie/offline cache에 저장하지 않습니다.

이 흐름은 별도 학습 모델이나 fine-tuning이 아니라, 계속 바뀌는 **승인된 질의응답을 검색해 근거로
제공하는 RAG**입니다. fine-tuning은 나중에 말투·출력 형식을 맞추는 선택지가 될 수 있지만 승인
지식의 추가·수정·철회를 대신하지 않습니다. 검색된 근거로 만든 초안도 목회자가 반드시 검토하고
편집해야 하며, 승인 전에는 공개되지 않습니다.

질문 embedding은 retrieval query에만 사용하며 answer embedding으로 저장하거나 재사용하지 않습니다.
관리자가 승인하면 DB가 normalized 최종 답변의 SHA-256을 검증하고, retrieval body를
`Question: <question>\nAnswer: <final answer>` 형식으로 만든 뒤 별도의 SHA-256을 계산합니다. 같은 transaction에서
revision/publication/citation과 `published_answer` source/chunk를 만듭니다. 새 chunk의 embedding은
NULL이지만 FTS-first hybrid retrieval에 즉시 포함되고, 남은 slot만 non-NULL embedding의 exact
cosine 결과로 채웁니다. 검증된 service 작업은 `qa_backfill_approved_chunk_embedding`에 chunk ID와
expected hash를 전달해 embedding을 한 번만 채울 수 있습니다. 이 backfill RPC는 `qa-draft` Edge
Function에서 호출하지 않습니다.

게시된 답변을 다시 열면 같은 transaction에서 공개 답변과 공개 citation을 즉시 제거하고, 해당
revision의 `published_answer` source를 inactive로 전환합니다. 이후 답변 없이 종료(reject)해도 같은
철회 helper가 idempotent하게 실행되므로 이전 공개물이나 active retrieval source가 남지 않습니다.
source/chunk/revision 이력 자체는 삭제하지 않습니다.

승인 corpus/source/chunk의 일반 client insert/update는 허용하지 않습니다. private `qa-sources`
bucket은 app-owned RESTRICTIVE policy로 anon/authenticated만 차단하며 다른 bucket policy는 수정하지
않습니다.

### Schema와 Edge Function 배포

배포는 CI가 자동 수행하지 않습니다. 아래 작업은 프로젝트 소유자가 검증 결과를 확인한 뒤 직접
수행하며, 순서는 **검증 → schema → Edge Function → Function Secrets → 승인 corpus 준비/import →
published-answer backfill → 앱 배포**입니다.

1. `npm run typecheck`, `npm run lint`, `npm run test:qa`, `npm run build:all`을 실행합니다.
2. Supabase SQL Editor에서 `supabase/schema.sql`을 다시 실행합니다. 파일은 sermon 영문 nullable
   column, pgvector(`extensions` schema), Q&A RPC/RLS/grant, private `qa-sources` bucket을 idempotent하게
   구성합니다. schema 재적용은 이 수정 이전에 남은 non-approved legacy publication도 승인 상태의
   publication에는 영향 없이 idempotent하게 철회합니다.
3. `supabase functions deploy qa-draft`로 Edge Function을 배포합니다.
4. Supabase Function Secrets에 아래 이름만 설정합니다.

```text
QA_AI_PROVIDER
QA_AI_API_KEY
QA_AI_MODEL
QA_AI_EMBEDDING_MODEL
QA_MIN_FTS_RANK
QA_TOP_K
QA_DRAFT_TIMEOUT_MS
```

`QA_AI_EMBEDDING_MODEL`은 승인 corpus와 같은 `text-embedding-3-small`(1536차원)이어야 합니다.
OpenAI provider는 embedding과 draft를 모두 수행합니다. Anthropic adapter는 Messages API draft를
구현하지만 Anthropic에 native embedding API가 없으므로 fixed OpenAI embedding corpus를 다른
vector로 우회하거나 end-to-end 지원을 주장하지 않고, draft claim 전에 안전하게 거부합니다.
별도 검증된 embedding provider 설계 전에는
end-to-end 운영값으로 `openai`를 사용합니다.

5. 아래 절차로 저장소 밖의 승인 자료를 준비하고 dry-run 확인 후 import합니다.
6. 이미 게시되어 NULL embedding인 active chunk를 backfill dry-run/apply로 처리합니다.
7. 마지막으로 사용자가 앱을 배포합니다. schema/function/secret/corpus 작업은 CI나 프런트엔드가
   대신 실행하지 않습니다.

이 이름들에 `VITE_`나 `NEXT_PUBLIC_` prefix를 붙이지 마세요. service role key와 model key는
client source, Vercel client env, 로그, 응답에 넣지 않습니다. Edge Function의 service client는
요청 JWT를 `auth.getUser`로 검증한 뒤에만 만들며 admin/evidence RPC에만 사용합니다.

### Q&A 관리자 등록과 진입

Q&A 관리자는 binder/sermon 관리자와 별도인 `qa_admins`에 등록합니다. anon key로 등록하지 말고
Supabase SQL Editor 또는 service role 연결에서 Authentication → Users의 사용자 ID를 사용합니다.

```sql
insert into public.qa_admins (user_id)
values ('<auth.users.id>')
on conflict (user_id) do nothing;
```

등록된 관리자로 로그인한 뒤 Q&A 화면 제목을 2초 안에 5번 탭하면 admin review mode가
토글됩니다. 일반 사용자는 질문과 published answer만 볼 수 있으며 draft/internal source는 볼 수
없습니다.

### 승인 corpus import

실제 역사 Q&A나 신학 자료는 저장소의 `data/`에 두지 말고
`/tmp/opencode/EDABible-qna-import`에서 검토·승인·staging합니다.
`data/qa-history.example.jsonl`은 형식 표시만 하는 빈 예시이며 corpus 내용이 아닙니다. 각 source는
`embeddingModel: "text-embedding-3-small"`과 `approved: true`를 명시해야 하고, 실제 각 entry에는
질문, 승인 답변, 해당 고정 모델로 생성된 1536개 finite embedding 값이 필요합니다.

원본 JSONL이 importer contract와 같지만 entry에 `question`/`answer`만 있고 embedding이 없다면 먼저
아래 준비 명령을 사용합니다. `--in`과 `--out`은 모두 저장소 밖이어야 합니다. 기본 실행은 입력
형식과 개수만 검증하는 dry-run으로, OpenAI를 호출하지 않고 출력 파일도 쓰지 않습니다. `--apply`에만
`OPENAI_API_KEY`를 shell/secret manager에서 제공합니다. 본문은 정확히
`Question: <trimmed question>\nAnswer: <trimmed answer>`로 정규화되며 최대 64개씩
`text-embedding-3-small` 1536차원 embedding을 생성합니다.

```bash
npm run prepare:qa-embeddings -- \
  --in /tmp/opencode/EDABible-qna-import/approved-source.jsonl \
  --out /tmp/opencode/EDABible-qna-import/qa-history.jsonl

# OPENAI_API_KEY는 저장소나 명령 기록에 직접 쓰지 않고 실행 환경에서만 주입
npm run prepare:qa-embeddings -- \
  --in /tmp/opencode/EDABible-qna-import/approved-source.jsonl \
  --out /tmp/opencode/EDABible-qna-import/qa-history.jsonl \
  --apply
```

준비 script는 질문·답변·정규화 body·vector·API key·provider response body를 로그에 남기지 않으며,
출력은 임시 파일을 같은 directory에 쓴 뒤 atomic rename합니다. `--limit N`으로 승인된 entry 수를
제한해 먼저 검증할 수 있습니다.

```bash
npm run import:qa-history -- --file /tmp/opencode/EDABible-qna-import/qa-history.jsonl
npm run import:qa-history -- --file /tmp/opencode/EDABible-qna-import/qa-history.jsonl --apply
```

기본 동작은 dry-run입니다. 출력의 `datasetHash`는 입력 batch 검토용 fingerprint일 뿐 corpus
identity가 아닙니다. `qa_corpus_versions`의 v1 row는 `text-embedding-3-small`·1536차원 retrieval
contract만 고정하므로 역사 자료가 하나도 없어도 첫 승인 답변을 즉시 FTS corpus로 승격할 수
있습니다. `--apply`는 각 원본을 source hash 기반 `v1/sources/<sourceHash>.json` 경로에 올리고
service-role import RPC로 새 source만 incrementally 추가합니다. 같은 source를 다시 실행하면 기존
row를 반환하므로 idempotent하며, 명령은 secret 값을 출력하지 않습니다.

### 게시 답변 embedding backfill

승인 시 생성된 active `published_answer` chunk 중 embedding이 NULL인 row만 오래된 순서로 조회합니다.
기본 limit은 50이고 `--limit N`(최대 500)으로 제한할 수 있습니다. 각 body의 SHA-256을 로컬에서
`content_hash`와 먼저 비교하며, 일치하지 않으면 OpenAI나 RPC를 호출하지 않고 skip합니다. apply는
고정 model/dimension으로 embedding한 뒤 service-role 전용
`qa_backfill_approved_chunk_embedding` RPC를 호출합니다. 이미 처리됐거나 상태가 바뀐 row는
`QA_BACKFILL_STALE`/`QA_BACKFILL_PRECONDITION_FAILED` skip으로 처리되어 재실행해도 안전합니다.

```bash
# dry-run 조회에는 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY만 실행 환경에서 주입
npm run backfill:qa-embeddings

# apply에만 OPENAI_API_KEY를 추가로 실행 환경에서 주입
npm run backfill:qa-embeddings -- --apply
```

세 값은 shell의 일시 환경변수나 secret manager에서만 주입합니다. service role/OpenAI key에는
`VITE_` 또는 `NEXT_PUBLIC_` prefix를 붙이지 않고, browser env·client source·CI workflow·로그에
넣지 않습니다. backfill summary에는 개수와 model/dimension만 포함되고 body/vector/key는 포함되지
않습니다.

정적 보안 검사는 다음과 같이 실행합니다. 이 검사는 credential을 읽지 않으며 live Supabase
통합 테스트를 통과했다고 주장하지 않습니다.

```bash
npm run check:qa-security
npm run test:qa
```

## 디비에 있는 성경 내려 받기

npm run pull:supabase-bible

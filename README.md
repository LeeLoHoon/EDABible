# EDABible

성경 묵상·필사 앱입니다.

성경 본문의 Git 원본은 `data/bible-chapters.jsonl`입니다. `public/bible/*.json`은 앱 배포용 산출물이며 `npm run build:bible`로 재생성합니다. Supabase가 설정되어 있으면 앱은 Supabase의 `bible_chapters`를 우선 읽고, 실패하면 `public/bible`과 IndexedDB 캐시를 사용합니다.

## Bible Data

```text
data/bible-books.json       # 66권 메타데이터
data/bible-chapters.jsonl   # 장 단위 본문 원본
public/bible/*.json         # 앱 배포용 산출물
```

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
npm run dev
npm run build:note
npm run build:binder
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
npm run build:all     # dist-all: 두 기능을 함께 포함한 통합 배포
```

Vercel 기본 배포는 `npm run build`를 사용하므로 `dist`에 말씀 묵상 노트만 생성합니다.

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

## 디비에 있는 성경 내려 받기

npm run pull:supabase-bible

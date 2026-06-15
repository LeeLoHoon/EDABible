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

## Supabase

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
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
npm run build:bible
npm run build
npm run validate:bible
npm run seed:supabase-bible
```

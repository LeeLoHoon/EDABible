import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)

async function text(path) {
  return readFile(new URL(path, ROOT), 'utf8')
}

function requireMatch(issues, value, pattern, message) {
  if (!pattern.test(value)) issues.push(message)
}

async function sourceFiles(directory) {
  const rootPath = fileURLToPath(new URL(directory, ROOT))
  const files = []
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (['.ts', '.tsx', '.mjs', '.sql'].includes(extname(entry.name))) files.push(child)
    }
  }
  await visit(rootPath)
  return files
}

export async function runQaSecurityChecks() {
  const issues = []
  const schema = await text('supabase/schema.sql')
  const edge = await text('supabase/functions/qa-draft/index.ts')
  const qaClient = await text('src/qa.ts')
  const qaAdminPanel = await text('src/components/QaAdminPanel.tsx')
  const historyImporter = await text('scripts/import_qa_history.mjs')
  const historyPreparation = await text('scripts/prepare_qa_embeddings.mjs')
  const approvedBackfill = await text('scripts/backfill_qa_embeddings.mjs')
  const historyExample = await text('data/qa-history.example.jsonl')

  for (const table of [
    'qa_corpus_versions',
    'qa_admins',
    'qa_questions',
    'qa_answers',
    'qa_revisions',
    'qa_sources',
    'qa_chunks',
    'qa_citations',
    'qa_published_answers',
    'qa_published_citations',
  ]) {
    requireMatch(issues, schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} RLS is missing`)
  }

  for (const fn of [
    'qa_submit_question',
    'qa_claim_draft',
    'qa_complete_insufficient_draft',
    'qa_complete_draft',
    'qa_update_working_answer',
    'qa_fail_draft',
    'qa_approve_answer',
    'qa_withdraw_publication',
    'qa_reopen_answer',
    'qa_reject_question',
    'qa_is_admin',
    'qa_evidence_gate',
    'qa_retrieve_evidence',
    'qa_backfill_approved_chunk_embedding',
    'qa_import_approved_source',
  ]) {
    const block = schema.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))?.[0]
    if (!block) issues.push(`${fn} is missing`)
    else if (!/security definer[\s\S]*set search_path = ''/i.test(block)) {
      issues.push(`${fn} is not a hardened SECURITY DEFINER function`)
    }
  }

  requireMatch(
    issues,
    schema,
    /create extension if not exists vector with schema extensions/i,
    'pgvector is not installed in extensions schema',
  )
  requireMatch(
    issues,
    schema,
    /create extension if not exists pgcrypto with schema extensions/i,
    'pgcrypto is not installed in extensions schema',
  )
  const corpusVersionColumns = schema.match(
    /create table if not exists public\.qa_corpus_versions \(([\s\S]*?)\n\);/i,
  )?.[1]
  if (!corpusVersionColumns) issues.push('qa_corpus_versions table is missing')
  else if (/content_hash/i.test(corpusVersionColumns)) {
    issues.push('qa_corpus_versions still stores a dataset content hash')
  }
  requireMatch(
    issues,
    schema,
    /alter table public\.qa_corpus_versions drop column if exists content_hash/i,
    'Legacy qa_corpus_versions dataset hash migration is missing',
  )
  requireMatch(
    issues,
    schema,
    /set_config\('edabible\.qa_corpus_mutation', 'on', true\)[\s\S]*insert into public\.qa_corpus_versions[\s\S]*'v1'[\s\S]*'text-embedding-3-small'[\s\S]*1536[\s\S]*QA_CORPUS_CONTRACT_MISMATCH[\s\S]*set_config\('edabible\.qa_corpus_mutation', 'off', true\)/i,
    'Controlled idempotent v1 retrieval-contract seed is missing',
  )
  if (/grant update[\s\S]{0,120}public\.qa_answers[\s\S]{0,80}authenticated/i.test(schema)) {
    issues.push('Authenticated direct qa_answers update grant is present')
  }
  if (/create policy[\s\S]{0,160}on public\.qa_answers for update/i.test(schema)) {
    issues.push('Authenticated direct qa_answers update policy is present')
  }
  if (/grant[\s\S]{0,120}public\.qa_(?:chunks|corpus_versions)[\s\S]{0,80}to (?:anon|authenticated)/i.test(schema)) {
    issues.push('Client role grant found for chunks or corpus versions')
  }
  if (/create policy[\s\S]{0,160}on public\.qa_(?:chunks|corpus_versions)/i.test(schema)) {
    issues.push('Client policy found for chunks or corpus versions')
  }
  if (/grant select on table public\.qa_sources to authenticated/i.test(schema)) {
    issues.push('Authenticated full-table qa_sources grant is present')
  }
  if (/grant select on table public\.qa_citations to authenticated/i.test(schema)) {
    issues.push('Authenticated full-table qa_citations grant is present')
  }
  const citationGrant = schema.match(
    /grant select \(([^)]*)\)\s*on table public\.qa_citations to authenticated/i,
  )?.[1]
  if (!citationGrant || !/\bid\b[\s\S]*\banswer_id\b[\s\S]*\bordinal\b[\s\S]*\bexcerpt\b/i.test(citationGrant)) {
    issues.push('Admin citation column grant is missing required UI columns')
  } else if (/chunk_id/i.test(citationGrant)) {
    issues.push('Admin citation column grant exposes chunk_id')
  }
  requireMatch(
    issues,
    schema,
    /unfinalize_bible_chapter[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
    'unfinalize_bible_chapter search_path is not hardened',
  )

  const publishedCitationColumns = schema.match(
    /create table if not exists public\.qa_published_citations \(([\s\S]*?)\n\);/i,
  )?.[1]
  if (!publishedCitationColumns) issues.push('qa_published_citations table is missing')
  else if (/chunk_id|score|storage_path|embedding|vector|prompt|\bbody\b/i.test(publishedCitationColumns)) {
    issues.push('Published citation schema exposes an internal field')
  }

  const serviceRpcNames = [...edge.matchAll(/serviceClient\.rpc\(\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )
  const allowedServiceRpcs = ['qa_evidence_gate', 'qa_is_admin', 'qa_retrieve_evidence']
  if (
    serviceRpcNames.length !== allowedServiceRpcs.length ||
    serviceRpcNames.some((name) => !allowedServiceRpcs.includes(name))
  ) {
    issues.push('Edge service client is used outside the three allowed RPCs')
  }
  const gatePosition = edge.indexOf("serviceClient.rpc('qa_evidence_gate'")
  const embedPosition = edge.indexOf('provider.embed(')
  const generatePosition = edge.indexOf('provider.generateDraft(')
  if (gatePosition < 0 || embedPosition < gatePosition || generatePosition < gatePosition) {
    issues.push('FTS evidence gate does not precede all provider calls')
  }
  requireMatch(
    issues,
    schema,
    /p_min_rank is null or p_min_rank <= 0/,
    'FTS evidence gate allows a zero threshold',
  )
  requireMatch(
    issues,
    schema,
    /qa_complete_insufficient_draft[\s\S]*p_force boolean[\s\S]*for update[\s\S]*QA_DRAFT_LEASE_ACTIVE[\s\S]*p_force[\s\S]*draft_ready[\s\S]*insufficient_evidence[\s\S]*delete from public\.qa_citations[\s\S]*draft_claimed_at = null/i,
    'Insufficient-evidence drafts are not persisted through a locked admin RPC',
  )
  requireMatch(
    issues,
    edge,
    /qa_complete_insufficient_draft[\s\S]*p_force: input\.force/i,
    'Edge does not pass force to insufficient-evidence regeneration',
  )
  requireMatch(
    issues,
    schema,
    /qa_submit_question[\s\S]*existing_question\.question <> pg_catalog\.btrim\(p_question\)[\s\S]*existing_question\.lang <> p_lang[\s\S]*QA_IDEMPOTENCY_CONFLICT/i,
    'Question idempotency token does not reject mismatched normalized payloads',
  )
  requireMatch(
    issues,
    qaClient,
    /QaIdempotencyConflictError[\s\S]*QA_IDEMPOTENCY_CONFLICT[\s\S]*QaDraftLeaseActiveError[\s\S]*QA_DRAFT_LEASE_ACTIVE/i,
    'Q&A client does not map idempotency and active-lease errors',
  )
  const claimBlock = schema.match(
    /create or replace function public\.qa_claim_draft\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (
    !claimBlock ||
    !/for update/i.test(claimBlock) ||
    !/draft_claimed_at[\s\S]*interval '5 minutes'[\s\S]*QA_DRAFT_LEASE_ACTIVE/i.test(claimBlock) ||
    !/claimed_at timestamptz[\s\S]*claimed_at := pg_catalog\.clock_timestamp\(\)[\s\S]*draft_claimed_at = claimed_at/i.test(
      claimBlock,
    ) ||
    !/version = next_version/i.test(claimBlock)
  ) {
    issues.push('Draft claim lease/reclaim/version guard is incomplete')
  }
  if (claimBlock) {
    const conflictUpdate = claimBlock.slice(claimBlock.indexOf('on conflict (question_id) do update'))
    if (
      !/pre_claim_status\s*=\s*public\.qa_answers\.status/i.test(conflictUpdate) ||
      /working_body\s*=\s*''|promotion_content_hash\s*=\s*null|insufficient_evidence\s*=\s*false/i.test(
        conflictUpdate,
      )
    ) {
      issues.push('Forced draft claim does not preserve prior answer content and promotion metadata')
    }
    if (/delete from public\.qa_citations/i.test(claimBlock)) {
      issues.push('Draft claim deletes preserved citations')
    }
    if (!/draft_restore_status[\s\S]*'draft_ready'/i.test(claimBlock)) {
      issues.push('Draft claim does not record prior draft restoration state')
    }
  }
  for (const transition of [
    'qa_complete_insufficient_draft',
    'qa_complete_draft',
    'qa_fail_draft',
    'qa_approve_answer',
    'qa_reject_question',
  ]) {
    const block = schema.match(
      new RegExp(`create or replace function public\\.${transition}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
    )?.[0]
    if (!block || !/draft_claimed_at = null/i.test(block)) {
      issues.push(`${transition} does not clear the draft lease`)
    }
  }
  const completeDraftBlock = schema.match(
    /create or replace function public\.qa_complete_draft\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (!completeDraftBlock) issues.push('qa_complete_draft is missing')
  else {
    if (/p_question_embedding|p_promotion_content_hash|question_embedding/i.test(completeDraftBlock)) {
      issues.push('qa_complete_draft still accepts client promotion metadata')
    }
    if (!/extensions\.digest[\s\S]*insufficient_evidence = false/i.test(completeDraftBlock)) {
      issues.push('qa_complete_draft does not compute its normalized body hash in DB')
    }
    if (!/pre_claim_status = null[\s\S]*draft_restore_status = null/i.test(completeDraftBlock)) {
      issues.push('qa_complete_draft does not clear draft restoration metadata')
    }
  }
  const insufficientBlock = schema.match(
    /create or replace function public\.qa_complete_insufficient_draft\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (
    !insufficientBlock ||
    !/pre_claim_status = null[\s\S]*draft_restore_status = null/i.test(insufficientBlock)
  ) {
    issues.push('qa_complete_insufficient_draft does not clear draft restoration metadata')
  }
  if (insufficientBlock) {
    const preservePosition = insufficientBlock.indexOf('if preserve_existing then')
    const elsePosition = insufficientBlock.indexOf('else', preservePosition)
    const deletePosition = insufficientBlock.indexOf('delete from public.qa_citations')
    const endPosition = insufficientBlock.indexOf('end if;', elsePosition)
    if (
      !/preserve_existing := found[\s\S]*insufficient_evidence = false[\s\S]*promotion_content_hash is not null/i.test(
        insufficientBlock,
      ) ||
      !/preservedExistingDraft', preserve_existing/i.test(insufficientBlock) ||
      preservePosition < 0 ||
      elsePosition < preservePosition ||
      deletePosition < elsePosition ||
      endPosition < deletePosition
    ) {
      issues.push('Insufficient regeneration can destroy an existing approvable draft or citations')
    }
    if (
      !/for update[\s\S]*p_expected_version[\s\S]*interval '5 minutes'[\s\S]*p_force/i.test(
        insufficientBlock,
      )
    ) {
      issues.push('Insufficient regeneration weakened its CAS, lease, or force guards')
    }
  }
  const failDraftBlock = schema.match(
    /create or replace function public\.qa_fail_draft\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (
    !failDraftBlock ||
    !/draft_restore_status = 'draft_ready'[\s\S]*status = 'draft_ready'[\s\S]*contentPreserved/i.test(
      failDraftBlock,
    )
  ) {
    issues.push('qa_fail_draft does not restore preserved draft-ready content')
  }
  const updateAnswerBlock = schema.match(
    /create or replace function public\.qa_update_working_answer\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (!updateAnswerBlock || /p_promotion_content_hash/i.test(updateAnswerBlock)) {
    issues.push('qa_update_working_answer accepts a client promotion hash')
  } else if (!/extensions\.digest/.test(updateAnswerBlock)) {
    issues.push('qa_update_working_answer does not compute SHA-256 in DB')
  }
  requireMatch(
    issues,
    schema,
    /embedding extensions\.vector\(1536\),[\s\S]*alter table public\.qa_chunks alter column embedding drop not null/i,
    'qa_chunks embedding is not nullable',
  )
  requireMatch(
    issues,
    edge,
    /preservedExistingDraft[\s\S]*!completed\.preservedExistingDraft[\s\S]*QA_INSUFFICIENT_BODY_MISMATCH[\s\S]*preservedExistingDraft: completed\.preservedExistingDraft/,
    'Edge does not safely handle a preserved insufficient-evidence result',
  )
  if (!/catch \(actionError\)[\s\S]*await loadQuestions\(questionId\)/.test(qaAdminPanel)) {
    issues.push('Q&A admin draft failures do not always reload question state')
  }
  requireMatch(
    issues,
    schema,
    /qa_approve_answer[\s\S]*promoted_body := 'Question: '[\s\S]*E'\\nAnswer: '[\s\S]*promoted_content_hash[\s\S]*set_config\('edabible\.qa_corpus_mutation'[\s\S]*set active = false[\s\S]*prior_revision\.answer_id = answer_row\.id[\s\S]*insert into public\.qa_sources[\s\S]*'published_answer'[\s\S]*insert into public\.qa_chunks[\s\S]*promoted_body[\s\S]*null/i,
    'Approved answers are not atomically promoted into the corpus',
  )
  const withdrawBlock = schema.match(
    /create or replace function public\.qa_withdraw_publication\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (!withdrawBlock) issues.push('qa_withdraw_publication is missing')
  else {
    const citationDelete = withdrawBlock.indexOf('delete from public.qa_published_citations')
    const answerDelete = withdrawBlock.indexOf('delete from public.qa_published_answers')
    const sourceUpdate = withdrawBlock.indexOf('update public.qa_sources')
    if (
      !/qa_published_answers[\s\S]*revision_id[\s\S]*return false/i.test(withdrawBlock) ||
      citationDelete < 0 ||
      answerDelete < citationDelete ||
      sourceUpdate < answerDelete ||
      !/set_config\('edabible\.qa_corpus_mutation', 'on', true\)[\s\S]*update public\.qa_sources[\s\S]*set_config\('edabible\.qa_corpus_mutation', 'off', true\)/i.test(
        withdrawBlock,
      ) ||
      !/update public\.qa_sources[\s\S]*set active = false[\s\S]*source_kind = 'published_answer'[\s\S]*answer_revision_id = withdrawn_revision_id/i.test(
        withdrawBlock,
      ) ||
      /delete from public\.qa_(?:sources|chunks|revisions)/i.test(withdrawBlock)
    ) {
      issues.push('Publication withdrawal does not preserve and deactivate the approved corpus safely')
    }
  }
  const withdrawalEnd = withdrawBlock
    ? schema.indexOf(withdrawBlock) + withdrawBlock.length
    : -1
  const reopenStart = schema.indexOf('create or replace function public.qa_reopen_answer', withdrawalEnd)
  const legacyCleanupBlock =
    withdrawalEnd >= 0 && reopenStart > withdrawalEnd
      ? schema.slice(withdrawalEnd, reopenStart)
      : ''
  if (
    !/do \$\$[\s\S]*join public\.qa_published_answers as published[\s\S]*published\.question_id = question_row\.id[\s\S]*question_row\.status <> 'approved'[\s\S]*order by question_row\.id[\s\S]*for update of question_row[\s\S]*qa_withdraw_publication\(legacy_question\.id\)[\s\S]*\$\$;/i.test(
      legacyCleanupBlock,
    ) ||
    /delete from public\.qa_|update public\.qa_sources/i.test(legacyCleanupBlock)
  ) {
    issues.push('Idempotent legacy non-approved publication cleanup is missing or unsafe')
  }
  for (const transition of ['qa_reopen_answer', 'qa_reject_question']) {
    const block = schema.match(
      new RegExp(`create or replace function public\\.${transition}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
    )?.[0]
    const withdrawalPosition = block?.indexOf('qa_withdraw_publication(question_row.id)') ?? -1
    const validationPosition = block?.indexOf('QA_INVALID_TRANSITION') ?? -1
    const statusUpdatePosition = block?.indexOf(
      transition === 'qa_reopen_answer' ? 'update public.qa_answers' : 'next_version :=',
    ) ?? -1
    if (
      !block ||
      !/for update/i.test(block) ||
      validationPosition < 0 ||
      withdrawalPosition < validationPosition ||
      statusUpdatePosition < withdrawalPosition
    ) {
      issues.push(`${transition} does not withdraw publication after locking the question`)
    }
    if (!block || !/'publicationWithdrawn', publication_withdrawn/i.test(block)) {
      issues.push(`${transition} does not return publicationWithdrawn`)
    }
  }
  requireMatch(
    issues,
    schema,
    /revoke all on function public\.qa_withdraw_publication\(uuid\) from public, anon, authenticated, service_role/i,
    'Publication withdrawal helper is not revoked from every non-owner role',
  )
  if (
    /grant (?:execute|all) on function public\.qa_withdraw_publication\(uuid\) to (?:public|anon|authenticated|service_role)/i.test(
      schema,
    )
  ) {
    issues.push('Publication withdrawal helper has an external execute grant')
  }
  requireMatch(
    issues,
    schema,
    /add column if not exists active boolean not null default true[\s\S]*partition by revision\.answer_id[\s\S]*lineage_rank > 1/i,
    'Existing published-answer lineages are not migrated to one active source',
  )
  const retrieveBlock = schema.match(
    /create or replace function public\.qa_retrieve_evidence\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (
    !retrieveBlock ||
    retrieveBlock.indexOf('fts_matches') < 0 ||
    retrieveBlock.indexOf('vector_matches') < retrieveBlock.indexOf('fts_matches') ||
    !/embedding is not null/i.test(retrieveBlock) ||
    !/OPERATOR\(extensions\.<=>\)/i.test(retrieveBlock) ||
    !/source_row\.active/i.test(retrieveBlock) ||
    !/not exists/i.test(retrieveBlock)
  ) {
    issues.push('Deterministic FTS-first/null-safe hybrid retrieval is missing')
  }
  const gateBlock = schema.match(
    /create or replace function public\.qa_evidence_gate\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (!gateBlock || !/source_row\.active/i.test(gateBlock)) {
    issues.push('Evidence gate can use inactive sources')
  }
  const backfillBlock = schema.match(
    /create or replace function public\.qa_backfill_approved_chunk_embedding\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (
    !backfillBlock ||
    !/source_row\.active[\s\S]*into[\s\S]*source_active/i.test(backfillBlock) ||
    !/for update of chunk_row, source_row/i.test(backfillBlock) ||
    !/source_active is not true[\s\S]*source_kind <> 'published_answer'/i.test(backfillBlock) ||
    !/calculated_content_hash[\s\S]*existing_embedding is not null[\s\S]*set_config\('edabible\.qa_corpus_mutation'[\s\S]*set embedding = p_embedding/i.test(
      backfillBlock,
    )
  ) {
    issues.push('Published-answer embedding backfill is not fully hardened')
  }
  const importSourceBlock = schema.match(
    /create or replace function public\.qa_import_approved_source\([\s\S]*?\n\$\$;/i,
  )?.[0]
  if (!importSourceBlock) issues.push('qa_import_approved_source is missing')
  else {
    if (/p_corpus_hash|insert into public\.qa_corpus_versions/i.test(importSourceBlock)) {
      issues.push('Approved source import still depends on a dataset corpus hash')
    }
    if (
      !/where corpus\.version_key = 'v1'[\s\S]*corpus\.embedding_model = p_embedding_model[\s\S]*corpus\.embedding_dimension = 1536/i.test(
        importSourceBlock,
      ) ||
      !/where source\.content_hash = p_source_hash[\s\S]*return source_id/i.test(importSourceBlock)
    ) {
      issues.push('Approved source import is not bound to the fixed contract and source-hash idempotency')
    }
    if (
      !/p_embedding_model text[\s\S]*p_embedding_model <> 'text-embedding-3-small'/i.test(importSourceBlock) ||
      !/extensions\.digest[\s\S]*chunk\.value ->> 'body'[\s\S]*chunk\.value ->> 'contentHash'/i.test(importSourceBlock) ||
      !/jsonb_array_length\(chunk\.value -> 'embedding'\) <> 1536[\s\S]*jsonb_typeof\(embedding_value\.value\) <> 'number'/i.test(importSourceBlock)
    ) {
      issues.push('Historical import model/hash/vector provenance validation is incomplete')
    }
  }
  requireMatch(
    issues,
    schema,
    /drop function if exists public\.qa_import_approved_source\(text, text, text, text, text, jsonb\)/i,
    'Legacy dataset-hash import RPC overload is not dropped',
  )
  requireMatch(
    issues,
    schema,
    /revoke all on function public\.qa_import_approved_source\(text, text, text, text, text, jsonb\) from public, anon, authenticated[\s\S]*grant execute on function public\.qa_import_approved_source\(text, text, text, text, text, jsonb\) to service_role/i,
    'Source-hash import RPC permissions are not service-role-only',
  )
  if (/\bcorpusHash\b|p_corpus_hash/.test(historyImporter)) {
    issues.push('History importer still treats a dataset hash as corpus identity')
  }
  if (
    !historyImporter.includes('const storagePath = `v1/sources/${source.sourceHash}.json`') ||
    !historyImporter.includes('p_source_hash: source.sourceHash') ||
    !historyImporter.includes('p_embedding_model: EMBEDDING_MODEL') ||
    !historyImporter.includes("value.embeddingModel !== EMBEDDING_MODEL") ||
    !historyExample.includes('"embeddingModel":"text-embedding-3-small"')
  ) {
    issues.push('History importer does not enforce model provenance and deterministic source-hash paths')
  }
  for (const [name, value] of [
    ['History preparation', historyPreparation],
    ['Approved-answer backfill', approvedBackfill],
  ]) {
    if (/(?:VITE_|NEXT_PUBLIC_)(?:OPENAI|SUPABASE_SERVICE_ROLE|QA_)/i.test(value)) {
      issues.push(`${name} exposes a server credential through a public environment variable`)
    }
    const loggingStatements = value.match(/console\.(?:log|error|warn)\([^\n]*/g) ?? []
    if (
      loggingStatements.some((statement) =>
        /\b(?:apiKey|serviceRoleKey|question|answer|body|embedding|vector|payload|response)\b/.test(
          statement,
        ),
      )
    ) {
      issues.push(`${name} can log content, credentials, vectors, or provider responses`)
    }
  }
  requireMatch(
    issues,
    historyPreparation,
    /mode: apply \? 'apply' : 'dry-run'[\s\S]*sourceCount[\s\S]*entryCount[\s\S]*model: QA_EMBEDDING_MODEL[\s\S]*dimension: QA_EMBEDDING_DIMENSION[\s\S]*outPath[\s\S]*skipped/i,
    'History preparation does not emit the approved metadata-only summary',
  )
  requireMatch(
    issues,
    approvedBackfill,
    /\.is\('embedding', null\)[\s\S]*\.eq\('source\.source_kind', 'published_answer'\)[\s\S]*\.eq\('source\.active', true\)[\s\S]*\.order\('created_at', \{ ascending: true \}\)/i,
    'Approved-answer backfill selection is not NULL-only, active, published-answer, and oldest-first',
  )
  const providerCheckPosition = edge.indexOf('if (!provider.supportsEmbedding)')
  const claimPosition = edge.indexOf("userClient.rpc('qa_claim_draft'")
  if (providerCheckPosition < 0 || claimPosition < providerCheckPosition) {
    issues.push('Unsupported embedding providers can consume a draft attempt')
  }
  if (/createSignedUrl|createSignedUrls/.test(edge + qaClient)) {
    issues.push('Signed URL feature found in Q&A code')
  }
  if (/\.from\(['"]qa_questions['"]\)\s*\.insert/s.test(qaClient)) {
    issues.push('Q&A client directly inserts questions')
  }
  if (/\.from\(['"]qa_answers['"]\)\s*\.update/s.test(qaClient)) {
    issues.push('Q&A client directly updates answers')
  }
  if (/sha256Hex|p_promotion_content_hash|p_question_embedding/.test(edge + qaClient)) {
    issues.push('Client or Edge supplies forbidden promotion hash/query embedding metadata')
  }
  requireMatch(
    issues,
    edge,
    /failData[\s\S]*contentPreserved[\s\S]*previousDraftPreserved/,
    'Edge failure response does not expose the boolean preservation result',
  )
  if (/previousDraftPreserved[\s\S]{0,200}(?:workingBody|citations|prompt)/i.test(edge)) {
    issues.push('Edge preservation response exposes private draft content')
  }
  const insufficientRpcPosition = edge.indexOf("userClient.rpc(\n      'qa_complete_insufficient_draft'")
  if (insufficientRpcPosition < 0 || embedPosition < insufficientRpcPosition) {
    issues.push('Evidence-gate failure does not persist before all provider calls')
  }
  requireMatch(
    issues,
    qaClient,
    /insufficient_evidence[\s\S]*insufficientEvidence/i,
    'Persisted insufficientEvidence is missing from Q&A client types',
  )

  const storageSection = schema.slice(schema.indexOf("insert into storage.buckets"))
  requireMatch(
    issues,
    storageSection,
    /drop policy if exists "qa_sources_deny_client_operations" on storage\.objects;[\s\S]*create policy "qa_sources_deny_client_operations"[\s\S]*as restrictive[\s\S]*bucket_id <> 'qa-sources'/i,
    'Scoped restrictive qa-sources Storage policy is missing',
  )
  if (/pg_catalog\.pg_policies|for policy_row in|format\('drop policy/i.test(storageSection)) {
    issues.push('Storage migration can drop unrelated policies')
  }

  const checkDirectories = ['src/', 'scripts/', 'supabase/functions/']
  for (const directory of checkDirectories) {
    for (const file of await sourceFiles(directory)) {
      const path = relative(new URL('.', ROOT).pathname, file)
      if (path === 'scripts/check_qa_security.mjs') continue
      const value = await readFile(file, 'utf8')
      if (/\bas\s+any\b|@ts-ignore|@ts-expect-error/.test(value)) issues.push(`${path} contains type suppression`)
      if (/(?:VITE_|NEXT_PUBLIC_)(?:QA_(?:AI|MIN|TOP|DRAFT)|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)/.test(value)) {
        issues.push(`${path} exposes a server-only QA secret name`)
      }
    }
  }

  return issues
}

async function main() {
  const issues = await runQaSecurityChecks()
  if (issues.length > 0) {
    console.error(JSON.stringify({ staticQaSecurityCheck: 'failed', issues }, null, 2))
    process.exitCode = 1
    return
  }
  console.log('Static Q&A security checks passed. No live Supabase test was run (credentials not used).')
}

if (process.argv[1]?.endsWith('check_qa_security.mjs')) await main()

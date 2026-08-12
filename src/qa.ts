import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Lang } from './i18n/lang'

export type QaQuestionStatus =
  | 'submitted'
  | 'drafting'
  | 'draft_ready'
  | 'failed'
  | 'approved'
  | 'rejected'

export interface QaQuestion {
  id: string
  question: string
  lang: Lang
  status: QaQuestionStatus
  version: number
  /** 이어진 질문이면 루트 질문 id. 루트 자신은 없다. */
  rootQuestionId?: string
  /** 질문자가 게시 답변을 마지막으로 본 시각. 없으면 아직 안 읽은 것이다. */
  answerReadAt?: string
  draftClaimedAt?: string
  createdAt: string
  updatedAt: string
}

/** 목록 화면용 스레드 요약 — 안읽음 집계는 서버(qa_list_my_threads)에서 계산한다. */
export interface QaThreadSummary extends QaQuestion {
  followUpCount: number
  unread: boolean
  lastActivityAt: string
}

export interface QaPublishedAnswer {
  questionId: string
  revisionId: string
  body: string
  lang: Lang
  publishedAt: string
}

export interface QaPublishedCitation {
  id: string
  ordinal: number
  sourceTitle: string
  sourceUrl?: string
  excerpt: string
}

/** 스레드 한 칸 — 질문 하나와 (승인된 경우) 그 답변. */
export interface QaThreadItem {
  question: QaQuestion
  answer?: QaPublishedAnswer
  citations: QaPublishedCitation[]
}

export interface QaThread {
  root: QaQuestion
  /** 루트부터 시간순. 최소 1개(루트). */
  items: QaThreadItem[]
}

export interface QaAdminAnswer {
  id: string
  questionId: string
  workingBody: string
  insufficientEvidence: boolean
  status: 'drafting' | 'draft_ready' | 'failed' | 'approved'
  updatedAt: string
}

export interface QaAdminCitation {
  id: string
  ordinal: number
  excerpt: string
}

export interface QaRevision {
  id: string
  questionId: string
  revisionNumber: number
  body: string
  createdAt: string
}

export interface QaTransitionResult {
  questionId: string
  status: QaQuestionStatus
  version: number
  answerId?: string
  revisionId?: string
  idempotent?: boolean
  insufficientEvidence?: boolean
  publicationWithdrawn?: boolean
}

export interface QaDraftInvocationResult extends QaTransitionResult {
  insufficientEvidence?: boolean
  preservedExistingDraft?: boolean
  message?: string
}

interface QaQuestionRow {
  id: string
  question: string
  lang: Lang
  status: QaQuestionStatus
  version: number
  root_question_id: string | null
  answer_read_at: string | null
  draft_claimed_at: string | null
  created_at: string
  updated_at: string
}

interface QaPublishedAnswerRow {
  question_id: string
  revision_id: string
  body: string
  lang: Lang
  published_at: string
}

interface QaPublishedCitationRow {
  id: string
  question_id: string
  ordinal: number
  source_title: string
  source_url: string | null
  excerpt: string
}

interface QaAdminAnswerRow {
  id: string
  question_id: string
  working_body: string
  insufficient_evidence: boolean
  status: QaAdminAnswer['status']
  updated_at: string
}

interface QaRevisionRow {
  id: string
  question_id: string
  revision_number: number
  body: string
  created_at: string
}

interface QaAdminCitationRow {
  id: string
  ordinal: number
  excerpt: string
}

interface QaErrorLike {
  message: string
  code?: string
}

export class QaStaleVersionError extends Error {
  constructor() {
    super('QA_STALE_VERSION')
    this.name = 'QaStaleVersionError'
  }
}

export class QaIdempotencyConflictError extends Error {
  constructor() {
    super('QA_IDEMPOTENCY_CONFLICT')
    this.name = 'QaIdempotencyConflictError'
  }
}

export class QaDraftLeaseActiveError extends Error {
  constructor() {
    super('QA_DRAFT_LEASE_ACTIVE')
    this.name = 'QaDraftLeaseActiveError'
  }
}

export class QaDraftFailedError extends Error {
  readonly previousDraftPreserved: boolean

  constructor(message: string, previousDraftPreserved: boolean) {
    super(message)
    this.name = 'QaDraftFailedError'
    this.previousDraftPreserved = previousDraftPreserved
  }
}

function qaClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

function throwQaError(error: QaErrorLike): never {
  // 과거 배포는 errcode 40001을 썼으나 PostgREST가 40001을 무한 재시도해 P0001로 바꿨다.
  // 코드가 아니라 메시지로 분기한다 — P0001은 모든 raise exception의 기본 코드라 겹친다.
  if (error.message.includes('QA_STALE_VERSION') || error.code === '40001') {
    throw new QaStaleVersionError()
  }
  if (error.message.includes('QA_IDEMPOTENCY_CONFLICT')) {
    throw new QaIdempotencyConflictError()
  }
  if (error.message.includes('QA_DRAFT_LEASE_ACTIVE')) {
    throw new QaDraftLeaseActiveError()
  }
  throw new Error(error.message)
}

function mapQuestion(row: QaQuestionRow): QaQuestion {
  return {
    id: row.id,
    question: row.question,
    lang: row.lang,
    status: row.status,
    version: row.version,
    ...(row.root_question_id ? { rootQuestionId: row.root_question_id } : {}),
    ...(row.answer_read_at ? { answerReadAt: row.answer_read_at } : {}),
    ...(row.draft_claimed_at ? { draftClaimedAt: row.draft_claimed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isQaQuestionStatus(value: unknown): value is QaQuestionStatus {
  return (
    value === 'submitted' ||
    value === 'drafting' ||
    value === 'draft_ready' ||
    value === 'failed' ||
    value === 'approved' ||
    value === 'rejected'
  )
}

function parseRpcQuestion(value: unknown): QaQuestion {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('question' in value) ||
    typeof value.question !== 'string' ||
    !('lang' in value) ||
    (value.lang !== 'ko' && value.lang !== 'en') ||
    !('status' in value) ||
    !isQaQuestionStatus(value.status) ||
    !('version' in value) ||
    typeof value.version !== 'number' ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'string' ||
    !('updatedAt' in value) ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('QA_INVALID_RESPONSE')
  }
  return {
    id: value.id,
    question: value.question,
    lang: value.lang,
    status: value.status,
    version: value.version,
    ...('rootQuestionId' in value && typeof value.rootQuestionId === 'string'
      ? { rootQuestionId: value.rootQuestionId }
      : {}),
    ...('answerReadAt' in value && typeof value.answerReadAt === 'string'
      ? { answerReadAt: value.answerReadAt }
      : {}),
    ...('draftClaimedAt' in value && typeof value.draftClaimedAt === 'string'
      ? { draftClaimedAt: value.draftClaimedAt }
      : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function parseTransition(value: unknown): QaTransitionResult {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('questionId' in value) ||
    typeof value.questionId !== 'string' ||
    !('status' in value) ||
    !isQaQuestionStatus(value.status) ||
    !('version' in value) ||
    typeof value.version !== 'number'
  ) {
    throw new Error('QA_INVALID_RESPONSE')
  }
  return {
    questionId: value.questionId,
    status: value.status,
    version: value.version,
    ...('answerId' in value && typeof value.answerId === 'string'
      ? { answerId: value.answerId }
      : {}),
    ...('revisionId' in value && typeof value.revisionId === 'string'
      ? { revisionId: value.revisionId }
      : {}),
    ...('idempotent' in value && typeof value.idempotent === 'boolean'
      ? { idempotent: value.idempotent }
      : {}),
    ...('insufficientEvidence' in value && typeof value.insufficientEvidence === 'boolean'
      ? { insufficientEvidence: value.insufficientEvidence }
      : {}),
    ...('publicationWithdrawn' in value && typeof value.publicationWithdrawn === 'boolean'
      ? { publicationWithdrawn: value.publicationWithdrawn }
      : {}),
  }
}

function parseDraftInvocation(value: unknown): QaDraftInvocationResult {
  const transition = parseTransition(value)
  if (typeof value !== 'object' || value === null) throw new Error('QA_INVALID_RESPONSE')
  return {
    ...transition,
    ...('insufficientEvidence' in value && typeof value.insufficientEvidence === 'boolean'
      ? { insufficientEvidence: value.insufficientEvidence }
      : {}),
    ...('preservedExistingDraft' in value && typeof value.preservedExistingDraft === 'boolean'
      ? { preservedExistingDraft: value.preservedExistingDraft }
      : {}),
    ...('message' in value && typeof value.message === 'string' ? { message: value.message } : {}),
  }
}

/** caller가 재시도 동안 보존하는 stable UUID token으로만 질문을 제출한다. */
export async function submitQaQuestion(input: {
  question: string
  lang: Lang
  clientToken: string
  /** 이어진 질문이면 답변이 게시된 루트 질문의 id. */
  rootQuestionId?: string
}): Promise<QaQuestion> {
  const { data, error } = await qaClient()
    .rpc('qa_submit_question', {
      p_question: input.question,
      p_lang: input.lang,
      p_client_token: input.clientToken,
      p_root_question_id: input.rootQuestionId ?? null,
    })
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseRpcQuestion(data)
}

/** 사용자에게는 본인 질문 metadata와 이미 publish된 답변만 읽힌다. */
/** 목록은 스레드(루트) 단위다. 안읽음·이어진 질문 수는 서버가 집계해 왕복을 늘리지 않는다. */
export async function listMyQaThreads(): Promise<QaThreadSummary[]> {
  const { data, error } = await qaClient().rpc('qa_list_my_threads')
  if (error) throwQaError(error)
  if (!Array.isArray(data)) return []
  return data.map((value) => {
    const question = parseRpcQuestion(value)
    const record = value as Record<string, unknown>
    return {
      ...question,
      followUpCount: typeof record.followUpCount === 'number' ? record.followUpCount : Number(record.followUpCount ?? 0),
      unread: record.unread === true,
      lastActivityAt:
        typeof record.lastActivityAt === 'string' ? record.lastActivityAt : question.updatedAt,
    }
  })
}

/** 질문자가 게시 답변을 열어봤다고 기록한다. 실패해도 열람 자체는 막지 않는다. */
export async function markQaAnswerRead(questionId: string): Promise<void> {
  const { error } = await qaClient().rpc('qa_mark_answer_read', { p_question_id: questionId })
  if (error) throwQaError(error)
}

const QA_QUESTION_COLUMNS =
  'id, question, lang, status, version, root_question_id, answer_read_at, draft_claimed_at, created_at, updated_at'

/**
 * 루트 질문과 이어진 질문을 한 스레드로 읽는다. questionId는 스레드 안의 어느 질문이어도 된다.
 * 항목마다 왕복하지 않도록 답변·인용은 `in` 필터로 한 번에 가져온다.
 */
export async function readMyPublishedQaThread(questionId: string): Promise<QaThread | undefined> {
  const client = qaClient()
  const { data: entryData, error: entryError } = await client
    .from('qa_questions')
    .select(QA_QUESTION_COLUMNS)
    .eq('id', questionId)
    .maybeSingle<QaQuestionRow>()
  if (entryError) throwQaError(entryError)
  if (!entryData) return undefined

  const rootId = entryData.root_question_id ?? entryData.id
  const { data: memberData, error: memberError } = await client
    .from('qa_questions')
    .select(QA_QUESTION_COLUMNS)
    .or(`id.eq.${rootId},root_question_id.eq.${rootId}`)
    .order('created_at', { ascending: true })
    .returns<QaQuestionRow[]>()
  if (memberError) throwQaError(memberError)

  const members = memberData ?? []
  const rootRow = members.find((row) => row.id === rootId)
  if (!rootRow) return undefined
  const memberIds = members.map((row) => row.id)

  const { data: answerData, error: answerError } = await client
    .from('qa_published_answers')
    .select('question_id, revision_id, body, lang, published_at')
    .in('question_id', memberIds)
    .returns<QaPublishedAnswerRow[]>()
  if (answerError) throwQaError(answerError)
  const answers = new Map((answerData ?? []).map((row) => [row.question_id, row]))

  let citationRows: QaPublishedCitationRow[] = []
  if (answers.size > 0) {
    const { data, error } = await client
      .from('qa_published_citations')
      .select('id, question_id, ordinal, source_title, source_url, excerpt')
      .in('question_id', [...answers.keys()])
      .order('ordinal')
      .returns<QaPublishedCitationRow[]>()
    if (error) throwQaError(error)
    citationRows = data ?? []
  }

  const items: QaThreadItem[] = members.map((row) => {
    const answer = answers.get(row.id)
    return {
      question: mapQuestion(row),
      ...(answer
        ? {
            answer: {
              questionId: answer.question_id,
              revisionId: answer.revision_id,
              body: answer.body,
              lang: answer.lang,
              publishedAt: answer.published_at,
            },
          }
        : {}),
      citations: citationRows
        .filter((citation) => citation.question_id === row.id)
        .map((citation) => ({
          id: citation.id,
          ordinal: citation.ordinal,
          sourceTitle: citation.source_title,
          ...(citation.source_url ? { sourceUrl: citation.source_url } : {}),
          excerpt: citation.excerpt,
        })),
    }
  })

  return { root: mapQuestion(rootRow), items }
}

export async function isQaAdmin(): Promise<boolean> {
  const { data: authData, error: authError } = await qaClient().auth.getUser()
  if (authError || !authData.user) return false
  const { data, error } = await qaClient()
    .from('qa_admins')
    .select('user_id')
    .eq('user_id', authData.user.id)
    .maybeSingle<{ user_id: string }>()
  return !error && data !== null
}

export async function listQaAdminQuestions(): Promise<QaQuestion[]> {
  const { data, error } = await qaClient()
    .from('qa_questions')
    .select(QA_QUESTION_COLUMNS)
    .order('created_at', { ascending: false })
    .returns<QaQuestionRow[]>()
  if (error) throwQaError(error)
  return (data ?? []).map(mapQuestion)
}

export async function readQaAdminAnswer(questionId: string): Promise<QaAdminAnswer | undefined> {
  const { data, error } = await qaClient()
    .from('qa_answers')
    .select('id, question_id, working_body, insufficient_evidence, status, updated_at')
    .eq('question_id', questionId)
    .maybeSingle<QaAdminAnswerRow>()
  if (error) throwQaError(error)
  if (!data) return undefined
  return {
    id: data.id,
    questionId: data.question_id,
    workingBody: data.working_body,
    insufficientEvidence: data.insufficient_evidence,
    status: data.status,
    updatedAt: data.updated_at,
  }
}

/** 관리자 review UI에는 정제된 excerpt만 전달하고 내부 chunk/source 식별자는 선택하지 않는다. */
export async function listQaAdminCitations(answerId: string): Promise<QaAdminCitation[]> {
  const { data, error } = await qaClient()
    .from('qa_citations')
    .select('id, ordinal, excerpt')
    .eq('answer_id', answerId)
    .order('ordinal')
    .returns<QaAdminCitationRow[]>()
  if (error) throwQaError(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    excerpt: row.excerpt,
  }))
}

export async function listQaRevisions(questionId: string): Promise<QaRevision[]> {
  const { data, error } = await qaClient()
    .from('qa_revisions')
    .select('id, question_id, revision_number, body, created_at')
    .eq('question_id', questionId)
    .order('revision_number', { ascending: false })
    .returns<QaRevisionRow[]>()
  if (error) throwQaError(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    questionId: row.question_id,
    revisionNumber: row.revision_number,
    body: row.body,
    createdAt: row.created_at,
  }))
}

export async function saveQaWorkingBody(
  questionId: string,
  workingBody: string,
  expectedVersion: number,
): Promise<QaTransitionResult> {
  const normalizedBody = workingBody.trim()
  const { data, error } = await qaClient().rpc('qa_update_working_answer', {
    p_question_id: questionId,
    p_expected_version: expectedVersion,
    p_working_body: normalizedBody,
  })
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseTransition(data)
}

async function runTransition(
  name: 'qa_approve_answer' | 'qa_reopen_answer',
  questionId: string,
  expectedVersion: number,
): Promise<QaTransitionResult> {
  const { data, error } = await qaClient()
    .rpc(name, { p_question_id: questionId, p_expected_version: expectedVersion })
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseTransition(data)
}

export function approveQaAnswer(
  questionId: string,
  expectedVersion: number,
): Promise<QaTransitionResult> {
  return runTransition('qa_approve_answer', questionId, expectedVersion)
}

export function reopenQaAnswer(
  questionId: string,
  expectedVersion: number,
): Promise<QaTransitionResult> {
  return runTransition('qa_reopen_answer', questionId, expectedVersion)
}

export async function rejectQaQuestion(
  questionId: string,
  expectedVersion: number,
  reason: string,
): Promise<QaTransitionResult> {
  const { data, error } = await qaClient()
    .rpc('qa_reject_question', {
      p_question_id: questionId,
      p_expected_version: expectedVersion,
      p_reason: reason,
    })
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseTransition(data)
}

export async function invokeQaDraft(input: {
  questionId: string
  expectedVersion: number
  force: boolean
}): Promise<QaDraftInvocationResult> {
  const { data, error } = await qaClient().functions.invoke<unknown>('qa-draft', {
    body: input,
  })
  if (error instanceof FunctionsHttpError) {
    let payload: unknown
    try {
      payload = await error.context.json()
    } catch (parseError) {
      throw new Error(error.message, { cause: parseError })
    }
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      payload.error === 'QA_STALE_VERSION'
    ) {
      throw new QaStaleVersionError()
    }
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      payload.error === 'QA_DRAFT_LEASE_ACTIVE'
    ) {
      throw new QaDraftLeaseActiveError()
    }
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
    ) {
      throw new QaDraftFailedError(
        payload.error,
        'previousDraftPreserved' in payload && payload.previousDraftPreserved === true,
      )
    }
    throw new Error(error.message)
  }
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseDraftInvocation(data)
}

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
  draftClaimedAt?: string
  createdAt: string
  updatedAt: string
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

export interface QaThread {
  question: QaQuestion
  answer?: QaPublishedAnswer
  citations: QaPublishedCitation[]
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
}): Promise<QaQuestion> {
  const { data, error } = await qaClient()
    .rpc('qa_submit_question', {
      p_question: input.question,
      p_lang: input.lang,
      p_client_token: input.clientToken,
    })
  if (error) throwQaError(error)
  if (!data) throw new Error('QA_EMPTY_RESPONSE')
  return parseRpcQuestion(data)
}

/** 사용자에게는 본인 질문 metadata와 이미 publish된 답변만 읽힌다. */
export async function listMyQaQuestions(): Promise<QaQuestion[]> {
  const client = qaClient()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError) throwQaError(authError)
  if (!authData.user) return []
  const { data, error } = await client
    .from('qa_questions')
    .select('id, question, lang, status, version, draft_claimed_at, created_at, updated_at')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false })
    .returns<QaQuestionRow[]>()
  if (error) throwQaError(error)
  return (data ?? []).map(mapQuestion)
}

export async function readMyPublishedQaThread(questionId: string): Promise<QaThread | undefined> {
  const client = qaClient()
  const { data: questionData, error: questionError } = await client
    .from('qa_questions')
    .select('id, question, lang, status, version, draft_claimed_at, created_at, updated_at')
    .eq('id', questionId)
    .maybeSingle<QaQuestionRow>()
  if (questionError) throwQaError(questionError)
  if (!questionData) return undefined

  const { data: answerData, error: answerError } = await client
    .from('qa_published_answers')
    .select('question_id, revision_id, body, lang, published_at')
    .eq('question_id', questionId)
    .maybeSingle<QaPublishedAnswerRow>()
  if (answerError) throwQaError(answerError)

  let citationData: QaPublishedCitationRow[] = []
  if (answerData) {
    const { data, error } = await client
      .from('qa_published_citations')
      .select('id, ordinal, source_title, source_url, excerpt')
      .eq('question_id', questionId)
      .eq('revision_id', answerData.revision_id)
      .order('ordinal')
      .returns<QaPublishedCitationRow[]>()
    if (error) throwQaError(error)
    citationData = data ?? []
  }

  return {
    question: mapQuestion(questionData),
    ...(answerData
      ? {
          answer: {
            questionId: answerData.question_id,
            revisionId: answerData.revision_id,
            body: answerData.body,
            lang: answerData.lang,
            publishedAt: answerData.published_at,
          },
        }
      : {}),
    citations: citationData.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      sourceTitle: row.source_title,
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      excerpt: row.excerpt,
    })),
  }
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
    .select('id, question, lang, status, version, draft_claimed_at, created_at, updated_at')
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

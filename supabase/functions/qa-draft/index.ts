import { createClient } from 'npm:@supabase/supabase-js@2'
import { createQaProvider, type QaAiProvider, type QaEvidence } from './providers/index.ts'
import {
  failureCodeFor,
  insufficientEvidenceMessage,
  isUuid,
  publicErrorMessage,
  sanitizeDraftBody,
} from './sanitize.ts'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
}

type QaQuestionStatus =
  | 'submitted'
  | 'drafting'
  | 'draft_ready'
  | 'failed'
  | 'approved'
  | 'rejected'

interface DraftInput {
  questionId: string
  expectedVersion: number
  force: boolean
}

interface EvidenceGate {
  passed: boolean
  questionId: string
  question: string
  lang: 'ko' | 'en'
  status: QaQuestionStatus
  version: number
}

interface DraftClaim {
  questionId: string
  answerId: string
  question: string
  lang: 'ko' | 'en'
  status: 'drafting'
  version: number
  claimedAt: string
}

interface InsufficientDraftCompletion {
  questionId: string
  answerId: string
  workingBody: string
  insufficientEvidence: boolean
  preservedExistingDraft: boolean
  status: 'draft_ready'
  version: number
}

interface TransitionResult {
  questionId: string
  status: QaQuestionStatus
  version: number
  answerId?: string
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'cache-control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isQuestionStatus(value: unknown): value is QaQuestionStatus {
  return (
    value === 'submitted' ||
    value === 'drafting' ||
    value === 'draft_ready' ||
    value === 'failed' ||
    value === 'approved' ||
    value === 'rejected'
  )
}

function parseInput(value: unknown): DraftInput | undefined {
  if (!isRecord(value)) return undefined
  if (!isUuid(value.questionId)) return undefined
  if (
    typeof value.expectedVersion !== 'number' ||
    !Number.isInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  )
    return undefined
  if (typeof value.force !== 'boolean') return undefined
  return {
    questionId: value.questionId,
    expectedVersion: Number(value.expectedVersion),
    force: value.force,
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error('QA_FUNCTION_CONFIG_ERROR')
  return value
}

function finiteNumber(name: string, minimum: number, maximum: number): number {
  const value = Number(requireEnv(name))
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error('QA_FUNCTION_CONFIG_ERROR')
  }
  return value
}

function parseGate(value: unknown): EvidenceGate {
  if (
    !isRecord(value) ||
    typeof value.passed !== 'boolean' ||
    !isUuid(value.questionId) ||
    typeof value.question !== 'string' ||
    (value.lang !== 'ko' && value.lang !== 'en') ||
    !isQuestionStatus(value.status) ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version)
  ) {
    throw new Error('QA_RETRIEVAL_INVALID_GATE')
  }
  return {
    passed: value.passed,
    questionId: value.questionId,
    question: value.question,
    lang: value.lang,
    status: value.status,
    version: Number(value.version),
  }
}

function parseClaim(value: unknown): DraftClaim {
  if (
    !isRecord(value) ||
    !isUuid(value.questionId) ||
    !isUuid(value.answerId) ||
    typeof value.question !== 'string' ||
    (value.lang !== 'ko' && value.lang !== 'en') ||
    value.status !== 'drafting' ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    typeof value.claimedAt !== 'string'
  ) {
    throw new Error('QA_RETRIEVAL_INVALID_CLAIM')
  }
  return {
    questionId: value.questionId,
    answerId: value.answerId,
    question: value.question,
    lang: value.lang,
    status: value.status,
    version: Number(value.version),
    claimedAt: value.claimedAt,
  }
}

function parseEvidence(value: unknown): QaEvidence[] {
  if (!Array.isArray(value)) throw new Error('QA_RETRIEVAL_INVALID_RESPONSE')
  return value.map((row) => {
    if (
      !isRecord(row) ||
      !isUuid(row.chunk_id) ||
      typeof row.source_title !== 'string' ||
      typeof row.body !== 'string'
    ) {
      throw new Error('QA_RETRIEVAL_INVALID_RESPONSE')
    }
    return { chunkId: row.chunk_id, sourceTitle: row.source_title, body: row.body }
  })
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`
}

function citationsUsedByDraft(body: string, evidence: readonly QaEvidence[]) {
  const ordinals = new Set<number>()
  for (const match of body.matchAll(/\[(\d{1,2})\]/g)) {
    const ordinal = Number(match[1]) - 1
    if (ordinal >= 0 && ordinal < evidence.length) ordinals.add(ordinal)
  }
  return [...ordinals]
    .sort((left, right) => left - right)
    .map((ordinal) => ({ chunkId: evidence[ordinal].chunkId, ordinal }))
}

function parseInsufficientCompletion(value: unknown): InsufficientDraftCompletion {
  if (
    !isRecord(value) ||
    !isUuid(value.questionId) ||
    !isUuid(value.answerId) ||
    typeof value.workingBody !== 'string' ||
    typeof value.insufficientEvidence !== 'boolean' ||
    typeof value.preservedExistingDraft !== 'boolean' ||
    value.status !== 'draft_ready' ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version)
  ) {
    throw new Error('QA_RETRIEVAL_INVALID_INSUFFICIENT_DRAFT')
  }
  return {
    questionId: value.questionId,
    answerId: value.answerId,
    workingBody: value.workingBody,
    insufficientEvidence: value.insufficientEvidence,
    preservedExistingDraft: value.preservedExistingDraft,
    status: value.status,
    version: value.version,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const authorization = request.headers.get('authorization')
  const bearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
  if (!bearer) return json({ error: 'AUTH_REQUIRED' }, 401)

  let rawInput: unknown
  try {
    rawInput = await request.json()
  } catch (error) {
    console.warn('qa-draft rejected invalid JSON.', error instanceof SyntaxError)
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  const input = parseInput(rawInput)
  if (!input) return json({ error: 'INVALID_REQUEST' }, 400)

  let supabaseUrl: string
  let anonKey: string
  let serviceRoleKey: string
  let minRank: number
  let topK: number
  let timeoutMs: number
  try {
    supabaseUrl = requireEnv('SUPABASE_URL')
    anonKey = requireEnv('SUPABASE_ANON_KEY')
    serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    minRank = finiteNumber('QA_MIN_FTS_RANK', 0.000001, 100)
    topK = finiteNumber('QA_TOP_K', 1, 12)
    timeoutMs = finiteNumber('QA_DRAFT_TIMEOUT_MS', 1000, 120000)
    if (!Number.isInteger(topK)) throw new Error('QA_FUNCTION_CONFIG_ERROR')
  } catch (error) {
    console.warn('qa-draft function configuration is incomplete.', error instanceof Error)
    return json({ error: 'QA_FUNCTION_CONFIG_ERROR' }, 500)
  }
  // getUser()는 global.headers.authorization과 충돌해 GoTrue가 Bearer를 못 찾는다("valid Bearer token"
  // 401). 검증은 헤더를 덮어쓰지 않은 전용 client로 하고, 토큰은 인자로만 넘긴다.
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser(bearer)
  if (authError || !authData.user) {
    console.warn('qa-draft could not verify the caller.', authError?.status ?? 'no-user')
    return json({ error: 'AUTH_REQUIRED' }, 401)
  }

  // RPC는 사용자 권한(RLS)으로 실행해야 하므로 Authorization을 실은 client를 따로 쓴다.
  // global.headers는 기본 헤더를 덮어쓰므로 PostgREST가 요구하는 apikey도 함께 싣는다.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { apikey: anonKey, authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // service role client는 검증된 사용자 확인 뒤에만 만들고, 아래 세 RPC 외에는 사용하지 않는다.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: adminData, error: adminError } = await serviceClient.rpc('qa_is_admin', {
    p_user_id: authData.user.id,
  })
  if (adminError || adminData !== true) return json({ error: 'ADMIN_REQUIRED' }, 403)

  // FTS gate는 provider 생성·embedding·generation보다 먼저 실행한다.
  const { data: gateData, error: gateError } = await serviceClient.rpc('qa_evidence_gate', {
    p_question_id: input.questionId,
    p_min_rank: minRank,
  })
  if (gateError) return json({ error: 'QA_DRAFT_RETRIEVAL_ERROR' }, 502)

  let gate: EvidenceGate
  try {
    gate = parseGate(gateData)
  } catch (error) {
    console.warn('qa-draft received an invalid evidence gate response.', error instanceof Error)
    return json({ error: 'QA_DRAFT_RETRIEVAL_ERROR' }, 502)
  }
  if (gate.version !== input.expectedVersion) return json({ error: 'QA_STALE_VERSION' }, 409)
  if (!gate.passed) {
    const { data: insufficientData, error: insufficientError } = await userClient.rpc(
      'qa_complete_insufficient_draft',
      {
        p_question_id: input.questionId,
        p_expected_version: input.expectedVersion,
        p_force: input.force,
      },
    )
    if (insufficientError) {
      if (insufficientError.message.includes('QA_STALE_VERSION')) {
        return json({ error: 'QA_STALE_VERSION' }, 409)
      }
      if (insufficientError.message.includes('QA_DRAFT_LEASE_ACTIVE')) {
        return json({ error: 'QA_DRAFT_LEASE_ACTIVE' }, 409)
      }
      return json({ error: 'QA_INVALID_TRANSITION' }, 400)
    }
    try {
      const completed = parseInsufficientCompletion(insufficientData)
      const expectedBody = insufficientEvidenceMessage(gate.lang)
      if (!completed.preservedExistingDraft && completed.workingBody !== expectedBody) {
        throw new Error('QA_INSUFFICIENT_BODY_MISMATCH')
      }
      return json(
        {
          questionId: completed.questionId,
          answerId: completed.answerId,
          status: completed.status,
          version: completed.version,
          insufficientEvidence: completed.insufficientEvidence,
          preservedExistingDraft: completed.preservedExistingDraft,
          ...(completed.preservedExistingDraft ? {} : { message: completed.workingBody }),
        },
        200,
      )
    } catch (error) {
      console.warn('qa-draft received an invalid insufficient draft response.', error instanceof Error)
      return json({ error: 'QA_DRAFT_FAILED' }, 500)
    }
  }

  let provider: QaAiProvider
  try {
    const providerName = requireEnv('QA_AI_PROVIDER')
    if (providerName !== 'openai' && providerName !== 'anthropic') {
      throw new Error('QA_FUNCTION_CONFIG_ERROR')
    }
    const embeddingModel = requireEnv('QA_AI_EMBEDDING_MODEL')
    if (embeddingModel !== 'text-embedding-3-small') throw new Error('QA_FUNCTION_CONFIG_ERROR')
    provider = createQaProvider({
      provider: providerName,
      apiKey: requireEnv('QA_AI_API_KEY'),
      model: requireEnv('QA_AI_MODEL'),
      embeddingModel,
    })
    if (!provider.supportsEmbedding) {
      return json({ error: 'QA_DRAFT_PROVIDER_UNSUPPORTED' }, 400)
    }
  } catch (error) {
    console.warn('qa-draft provider configuration is invalid.', error instanceof Error)
    return json({ error: 'QA_FUNCTION_CONFIG_ERROR' }, 500)
  }

  const { data: claimData, error: claimError } = await userClient.rpc('qa_claim_draft', {
    p_question_id: input.questionId,
    p_expected_version: input.expectedVersion,
    p_force: input.force,
  })
  if (claimError) {
    if (claimError.message.includes('QA_STALE_VERSION')) {
      return json({ error: 'QA_STALE_VERSION' }, 409)
    }
    if (claimError.message.includes('QA_DRAFT_LEASE_ACTIVE')) {
      return json({ error: 'QA_DRAFT_LEASE_ACTIVE' }, 409)
    }
    return json({ error: 'QA_INVALID_TRANSITION' }, 400)
  }

  let claim: DraftClaim
  try {
    claim = parseClaim(claimData)
  } catch (error) {
    console.warn('qa-draft received an invalid claim response.', error instanceof Error)
    return json({ error: 'QA_DRAFT_FAILED' }, 500)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const embedding = await provider.embed(claim.question, controller.signal)
    const { data: evidenceData, error: evidenceError } = await serviceClient.rpc(
      'qa_retrieve_evidence',
      {
        p_question_id: claim.questionId,
        p_query_embedding: vectorLiteral(embedding),
        p_top_k: topK,
      },
    )
    if (evidenceError) throw new Error('QA_RETRIEVAL_FAILED')
    const evidence = parseEvidence(evidenceData)
    if (evidence.length === 0) throw new Error('QA_RETRIEVAL_EMPTY')

    const body = sanitizeDraftBody(
      await provider.generateDraft(
        { question: claim.question, lang: claim.lang, evidence },
        controller.signal,
      ),
    )
    if (!body) throw new Error('QA_PROVIDER_INVALID_RESPONSE')
    const citations = citationsUsedByDraft(body, evidence)
    if (citations.length === 0) throw new Error('QA_PROVIDER_INVALID_RESPONSE')

    const { data: completedData, error: completeError } = await userClient.rpc(
      'qa_complete_draft',
      {
        p_question_id: claim.questionId,
        p_expected_version: claim.version,
        p_working_body: body,
        p_citations: citations,
      },
    )
    if (completeError?.message.includes('QA_STALE_VERSION')) throw new Error('QA_STALE_VERSION')
    if (completeError) throw new Error('QA_COMPLETE_FAILED')
    if (!isRecord(completedData)) throw new Error('QA_COMPLETE_FAILED')
    const result: TransitionResult = {
      questionId: claim.questionId,
      answerId: claim.answerId,
      status: 'draft_ready',
      version: Number(completedData.version),
    }
    if (!Number.isInteger(result.version)) throw new Error('QA_COMPLETE_FAILED')
    return json(result, 200)
  } catch (error) {
    if (error instanceof Error && error.message === 'QA_STALE_VERSION') {
      return json({ error: 'QA_STALE_VERSION' }, 409)
    }
    const failureCode = failureCodeFor(error)
    const { data: failData, error: failError } = await userClient.rpc('qa_fail_draft', {
      p_question_id: claim.questionId,
      p_expected_version: claim.version,
      p_failure_code: failureCode,
    })
    if (failError) console.warn('qa-draft could not persist its sanitized failure state.')
    const previousDraftPreserved =
      !failError &&
      isRecord(failData) &&
      typeof failData.contentPreserved === 'boolean' &&
      failData.contentPreserved
    return json(
      { error: publicErrorMessage(failureCode), previousDraftPreserved },
      failureCode === 'timeout' ? 504 : 502,
    )
  } finally {
    clearTimeout(timeout)
  }
})

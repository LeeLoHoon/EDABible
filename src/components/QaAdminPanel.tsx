import { useCallback, useEffect, useRef, useState } from 'react'
import {
  approveQaAnswer,
  invokeQaDraft,
  listQaAdminCitations,
  listQaAdminQuestions,
  listQaRevisions,
  QaDraftFailedError,
  QaDraftLeaseActiveError,
  QaStaleVersionError,
  readMyPublishedQaThread,
  readQaAdminAnswer,
  rejectQaQuestion,
  reopenQaAnswer,
  saveQaWorkingBody,
  type QaAdminAnswer,
  type QaAdminCitation,
  type QaQuestion,
  type QaQuestionStatus,
  type QaRevision,
  type QaThread,
} from '../qa'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'

type AdminBusy = 'refresh' | 'draft' | 'save' | 'approve' | 'reopen' | 'reject' | null

function formatQaDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getLang() === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function adminStatusLabel(status: QaQuestionStatus): string {
  if (status === 'submitted') return t('qaAdminStatusSubmitted')
  if (status === 'drafting') return t('qaAdminStatusDrafting')
  if (status === 'draft_ready') return t('qaAdminStatusDraftReady')
  if (status === 'failed') return t('qaAdminStatusFailed')
  if (status === 'approved') return t('qaAdminStatusApproved')
  return t('qaAdminStatusRejected')
}

function isConflict(error: unknown): boolean {
  if (error instanceof QaStaleVersionError) return true
  const message = error instanceof Error ? error.message : ''
  return (
    message.includes('QA_STALE_VERSION') ||
    message.includes('QA_INVALID_TRANSITION') ||
    message.includes('QA_ANSWER_STATE_MISMATCH')
  )
}

function adminErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (error instanceof QaDraftLeaseActiveError || message.includes('QA_DRAFT_LEASE_ACTIVE')) {
    return t('qaAdminLeaseActive')
  }
  if (message.includes('QA_DRAFT_ATTEMPT_LIMIT')) return t('qaAdminAttemptLimit')
  if (message.includes('QA_REJECTION_REASON_REQUIRED')) return t('qaAdminRejectReasonRequired')
  if (message.includes('QA_DRAFT_PROVIDER_UNSUPPORTED')) return t('qaAdminProviderUnsupported')
  if (message.includes('QA_FUNCTION_CONFIG_ERROR')) return t('qaAdminConfigError')
  return t('qaErrorGeneric')
}

function statusClass(status: QaQuestionStatus): string {
  if (status === 'approved') return 'bg-leaf-pale/70 text-leaf-deep'
  if (status === 'failed' || status === 'rejected') return 'bg-rose-bg text-rose-accent'
  if (status === 'draft_ready') return 'bg-rose-accent-deep text-white'
  return 'bg-rose-chip text-rose-key'
}

export default function QaAdminPanel() {
  const [questions, setQuestions] = useState<QaQuestion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [answer, setAnswer] = useState<QaAdminAnswer | undefined>()
  const [citations, setCitations] = useState<QaAdminCitation[]>([])
  const [revisions, setRevisions] = useState<QaRevision[]>([])
  const [publishedThread, setPublishedThread] = useState<QaThread | undefined>()
  const [workingBody, setWorkingBody] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loadedQuestionId, setLoadedQuestionId] = useState<string | null>(null)
  const [busy, setBusy] = useState<AdminBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const detailRequestRef = useRef(0)
  const questionsRequestRef = useRef(0)
  const selectedIdRef = useRef<string | null>(null)

  const selectedQuestion = questions.find((question) => question.id === selectedId)
  const pendingCount = questions.filter(
    (question) => question.status !== 'approved' && question.status !== 'rejected',
  ).length
  const orderedQuestions = [...questions].sort((left, right) => {
    const leftDone = left.status === 'approved' || left.status === 'rejected'
    const rightDone = right.status === 'approved' || right.status === 'rejected'
    return Number(leftDone) - Number(rightDone)
  })

  const clearDetail = useCallback((loadingDetail: boolean) => {
    detailRequestRef.current += 1
    setAnswer(undefined)
    setWorkingBody('')
    setCitations([])
    setRevisions([])
    setPublishedThread(undefined)
    setRejectionReason('')
    setLoadedQuestionId(null)
    setDetailLoading(loadingDetail)
  }, [])

  const selectQuestion = useCallback((questionId: string) => {
    if (selectedIdRef.current === questionId) return
    selectedIdRef.current = questionId
    clearDetail(true)
    setError(null)
    setNotice(null)
    setSelectedId(questionId)
  }, [clearDetail])

  const loadQuestions = useCallback(async (preferredId?: string | null) => {
    const requestId = ++questionsRequestRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await listQaAdminQuestions()
      if (requestId !== questionsRequestRef.current) return
      setQuestions(next)
      const preferred = preferredId ?? selectedIdRef.current
      const nextSelectedId =
        preferred && next.some((question) => question.id === preferred)
          ? preferred
          : next.find((question) => question.status !== 'approved' && question.status !== 'rejected')
              ?.id ?? next[0]?.id ?? null
      if (selectedIdRef.current !== nextSelectedId) {
        selectedIdRef.current = nextSelectedId
        clearDetail(nextSelectedId !== null)
      }
      setSelectedId(nextSelectedId)
    } catch (nextError) {
      if (requestId === questionsRequestRef.current) setError(adminErrorMessage(nextError))
    } finally {
      if (requestId === questionsRequestRef.current) setLoading(false)
    }
  }, [clearDetail])

  const loadDetail = useCallback(async (question: QaQuestion) => {
    const requestId = ++detailRequestRef.current
    setAnswer(undefined)
    setWorkingBody('')
    setCitations([])
    setRevisions([])
    setPublishedThread(undefined)
    setRejectionReason('')
    setLoadedQuestionId(null)
    setDetailLoading(true)
    setError(null)
    try {
      const nextAnswer = await readQaAdminAnswer(question.id)
      const [nextCitations, nextRevisions, nextPublished] = await Promise.all([
        nextAnswer ? listQaAdminCitations(nextAnswer.id) : Promise.resolve([]),
        listQaRevisions(question.id),
        question.status === 'approved'
          ? readMyPublishedQaThread(question.id)
          : Promise.resolve(undefined),
      ])
      if (
        requestId !== detailRequestRef.current ||
        selectedIdRef.current !== question.id ||
        (nextAnswer && nextAnswer.questionId !== question.id)
      ) return
      setAnswer(nextAnswer)
      setWorkingBody(nextAnswer?.workingBody ?? '')
      setCitations(nextCitations)
      setRevisions(nextRevisions)
      setPublishedThread(nextPublished)
      setRejectionReason('')
      setLoadedQuestionId(question.id)
    } catch (nextError) {
      if (requestId === detailRequestRef.current) setError(adminErrorMessage(nextError))
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadQuestions()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      questionsRequestRef.current += 1
    }
  }, [loadQuestions])

  useEffect(() => {
    if (!selectedQuestion) {
      detailRequestRef.current += 1
      return
    }
    const timer = window.setTimeout(() => {
      void loadDetail(selectedQuestion)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      detailRequestRef.current += 1
    }
  }, [loadDetail, selectedQuestion])

  const handleActionError = async (actionError: unknown, questionId: string) => {
    if (selectedIdRef.current !== questionId) return
    if (isConflict(actionError)) {
      setNotice(t('qaAdminConflictRefreshed'))
      setError(null)
      await loadQuestions(selectedId)
      return
    }
    setError(adminErrorMessage(actionError))
  }

  const requestDraft = async (force = false) => {
    if (
      !selectedQuestion ||
      busy ||
      detailLoading ||
      loadedQuestionId !== selectedQuestion.id ||
      selectedIdRef.current !== selectedQuestion.id
    ) return
    const questionId = selectedQuestion.id
    const expectedVersion = selectedQuestion.version
    setBusy('draft')
    setError(null)
    setNotice(null)
    try {
      const result = await invokeQaDraft({
        questionId,
        expectedVersion,
        force: force || selectedQuestion.status === 'failed' || selectedQuestion.status === 'draft_ready',
      })
      if (selectedIdRef.current !== questionId) return
      if (result.preservedExistingDraft) {
        setNotice(t('qaAdminInsufficientPreservedNotice'))
      } else if (result.insufficientEvidence) {
        setNotice(t('qaAdminInsufficientNotice'))
      } else {
        setNotice(t('qaAdminDraftReadyNotice'))
      }
      await loadQuestions(questionId)
    } catch (actionError) {
      let nextNotice: string | null = null
      let nextError: string | null = null
      if (actionError instanceof QaDraftFailedError && actionError.previousDraftPreserved) {
        nextNotice = t('qaAdminRegenerateFailedPreserved')
      } else if (isConflict(actionError)) {
        nextNotice = t('qaAdminConflictRefreshed')
      } else {
        nextError = adminErrorMessage(actionError)
      }
      const stillSelected = selectedIdRef.current === questionId
      await loadQuestions(selectedIdRef.current)
      if (!stillSelected || selectedIdRef.current !== questionId) return
      setNotice(nextNotice)
      setError(nextError)
    } finally {
      setBusy(null)
    }
  }

  const saveBody = async () => {
    if (
      !selectedQuestion ||
      !answer ||
      busy ||
      detailLoading ||
      loadedQuestionId !== selectedQuestion.id ||
      answer.questionId !== selectedQuestion.id ||
      selectedIdRef.current !== selectedQuestion.id
    ) return
    if (!workingBody.trim()) {
      setError(t('qaAdminBodyRequired'))
      return
    }
    const questionId = selectedQuestion.id
    const expectedVersion = selectedQuestion.version
    const body = workingBody
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      await saveQaWorkingBody(questionId, body, expectedVersion)
      if (selectedIdRef.current !== questionId) return
      setNotice(t('qaAdminSavedNotice'))
      await loadQuestions(questionId)
    } catch (actionError) {
      await handleActionError(actionError, questionId)
    } finally {
      setBusy(null)
    }
  }

  const approve = async () => {
    if (
      !selectedQuestion ||
      !answer ||
      busy ||
      detailLoading ||
      loadedQuestionId !== selectedQuestion.id ||
      answer.questionId !== selectedQuestion.id ||
      selectedIdRef.current !== selectedQuestion.id
    ) return
    if (!workingBody.trim()) {
      setError(t('qaAdminBodyRequired'))
      return
    }
    const questionId = selectedQuestion.id
    const answerId = answer.id
    setBusy('approve')
    setError(null)
    setNotice(null)
    try {
      let expectedVersion = selectedQuestion.version
      if (workingBody.trim() !== answer.workingBody.trim()) {
        const saved = await saveQaWorkingBody(questionId, workingBody, expectedVersion)
        expectedVersion = saved.version
      }
      if (
        selectedIdRef.current !== questionId ||
        answer.questionId !== questionId ||
        answer.id !== answerId
      ) return
      await approveQaAnswer(questionId, expectedVersion)
      if (selectedIdRef.current !== questionId) return
      setNotice(t('qaAdminPublishedNotice'))
      await loadQuestions(questionId)
    } catch (actionError) {
      await handleActionError(actionError, questionId)
    } finally {
      setBusy(null)
    }
  }

  const reopen = async () => {
    if (
      !selectedQuestion ||
      busy ||
      detailLoading ||
      loadedQuestionId !== selectedQuestion.id ||
      selectedIdRef.current !== selectedQuestion.id
    ) return
    const questionId = selectedQuestion.id
    const expectedVersion = selectedQuestion.version
    setBusy('reopen')
    setError(null)
    setNotice(null)
    try {
      const result = await reopenQaAnswer(questionId, expectedVersion)
      if (selectedIdRef.current !== questionId) return
      setNotice(
        t(result.publicationWithdrawn ? 'qaAdminReopenedWithdrawnNotice' : 'qaAdminReopenedNotice'),
      )
      await loadQuestions(questionId)
    } catch (actionError) {
      await handleActionError(actionError, questionId)
    } finally {
      setBusy(null)
    }
  }

  const reject = async () => {
    if (
      !selectedQuestion ||
      busy ||
      detailLoading ||
      loadedQuestionId !== selectedQuestion.id ||
      selectedIdRef.current !== selectedQuestion.id
    ) return
    if (!rejectionReason.trim()) {
      setError(t('qaAdminRejectReasonRequired'))
      return
    }
    const questionId = selectedQuestion.id
    const expectedVersion = selectedQuestion.version
    const reason = rejectionReason
    setBusy('reject')
    setError(null)
    setNotice(null)
    try {
      const result = await rejectQaQuestion(
        questionId,
        expectedVersion,
        reason,
      )
      if (selectedIdRef.current !== questionId) return
      setNotice(
        t(result.publicationWithdrawn ? 'qaAdminRejectedWithdrawnNotice' : 'qaAdminRejectedNotice'),
      )
      await loadQuestions(questionId)
    } catch (actionError) {
      await handleActionError(actionError, questionId)
    } finally {
      setBusy(null)
    }
  }

  const refresh = async () => {
    if (busy) return
    setBusy('refresh')
    setNotice(null)
    await loadQuestions(selectedId)
    setBusy(null)
  }

  const actionsDisabled =
    busy !== null ||
    detailLoading ||
    !selectedQuestion ||
    loadedQuestionId !== selectedQuestion.id

  return (
    <section className="rounded-3xl border-2 border-rose-accent-deep/40 bg-rose-card p-3 shadow-sm sm:p-4" aria-labelledby="qa-admin-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-line pb-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.24em] text-rose-accent-deep">{t('qaAdminEyebrow')}</p>
          <h2 id="qa-admin-title" className="mt-1 font-serif text-xl font-extrabold text-rose-ink">
            {t('qaAdminTitle')}
          </h2>
          <p className="mt-1 text-xs font-bold text-rose-key">{t('qaAdminPendingCount')(pendingCount)}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy !== null}
          className="min-h-11 rounded-full border border-rose-line bg-white px-4 py-2 text-sm font-bold text-rose-key transition hover:border-rose-accent hover:text-rose-accent focus:outline-none focus:ring-2 focus:ring-rose-accent disabled:opacity-50"
        >
          {busy === 'refresh' ? t('qaRefreshing') : t('qaRefresh')}
        </button>
      </header>

      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-accent/40 bg-rose-bg px-3 py-2 text-sm font-bold text-rose-accent">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-xl border border-leaf-soft bg-leaf-pale/40 px-3 py-2 text-sm font-bold text-leaf-deep">{notice}</p>}

      {loading ? (
        <p className="py-12 text-center text-sm font-bold text-rose-key">{t('qaLoading')}</p>
      ) : questions.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-rose-line px-4 py-12 text-center text-sm font-bold text-rose-key">
          {t('qaAdminEmpty')}
        </p>
      ) : (
        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="max-h-64 space-y-1.5 overflow-y-auto overscroll-contain rounded-2xl bg-rose-chip/40 p-2 md:max-h-[70vh]" aria-label={t('qaAdminQueue')}>
            {orderedQuestions.map((question) => {
              const active = question.id === selectedId
              return (
                <button
                  type="button"
                  key={question.id}
                  onClick={() => selectQuestion(question.id)}
                  aria-pressed={active}
                  className={`min-h-11 w-full rounded-xl border px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-rose-accent ${
                    active ? 'border-rose-accent bg-white shadow-sm' : 'border-transparent hover:bg-white/70'
                  }`}
                >
                  <span className="line-clamp-2 text-sm font-bold leading-5 text-rose-ink">{question.question}</span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(question.status)}`}>
                      {adminStatusLabel(question.status)}
                    </span>
                    <span className="text-[10px] font-bold text-rose-key/70">{formatQaDate(question.createdAt)}</span>
                  </span>
                </button>
              )
            })}
          </aside>

          <div className="min-w-0">
            {!selectedQuestion || detailLoading ? (
              <p className="py-12 text-center text-sm font-bold text-rose-key">{t('qaLoading')}</p>
            ) : (
              <article className="space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusClass(selectedQuestion.status)}`}>
                      {adminStatusLabel(selectedQuestion.status)}
                    </span>
                    <span className="text-xs font-bold text-rose-key">{formatQaDate(selectedQuestion.createdAt)}</span>
                  </div>
                  <h3 className="mt-2 whitespace-pre-wrap font-serif text-lg font-extrabold leading-7 text-rose-ink">
                    {selectedQuestion.question}
                  </h3>
                </div>

                {answer?.insufficientEvidence && selectedQuestion.status === 'draft_ready' && (
                  <div className="rounded-xl border border-rose-accent/40 bg-rose-bg px-3 py-3">
                    <p className="text-sm font-black text-rose-accent">{t('qaAdminInsufficientTitle')}</p>
                    <p className="mt-1 text-sm leading-6 text-rose-key">{t('qaAdminInsufficientNotice')}</p>
                  </div>
                )}

                {selectedQuestion.status === 'approved' && publishedThread?.answer ? (
                  <section className="rounded-2xl border border-leaf-soft bg-leaf-pale/20 p-4">
                    <h4 className="font-serif text-base font-extrabold text-leaf-deep">{t('qaAdminPublishedAnswer')}</h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-rose-ink">{publishedThread.answer.body}</p>
                    {publishedThread.citations.length > 0 && (
                      <ol className="mt-3 space-y-2 border-t border-leaf-soft/60 pt-3">
                        {publishedThread.citations.map((citation) => (
                          <li key={citation.id} className="text-xs leading-5 text-rose-key">
                            <span className="font-black text-rose-ink">[{citation.ordinal + 1}] {citation.sourceTitle}</span>
                            <span className="mt-0.5 block">{citation.excerpt}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                ) : answer && selectedQuestion.status === 'draft_ready' ? (
                  <section className="space-y-3 rounded-2xl border-2 border-rose-accent-deep/30 bg-rose-chip/35 p-3">
                    <div className="rounded-xl bg-rose-accent-deep px-3 py-2 text-white">
                      <p className="text-sm font-black">🔒 {t('qaAdminPrivateDraft')}</p>
                      <p className="mt-0.5 text-xs font-bold leading-5 text-white/85">{t('qaAdminPrivateDraftHint')}</p>
                    </div>
                    <p className="rounded-xl border border-rose-line bg-white px-3 py-2 text-xs font-bold leading-5 text-rose-key">
                      {t('qaAdminDraftSourceHint')}
                    </p>
                    <label className="block space-y-1.5">
                      <span className="block text-sm font-black text-rose-ink">{t('qaAdminWorkingBody')}</span>
                      <textarea
                        value={workingBody}
                        onChange={(event) => setWorkingBody(event.target.value)}
                        rows={12}
                        className="block w-full resize-y rounded-xl border border-rose-line bg-white p-3 text-base leading-7 text-rose-ink outline-none focus:border-rose-accent focus:ring-2 focus:ring-rose-accent"
                      />
                    </label>
                    {citations.length > 0 && (
                      <div>
                        <h4 className="text-sm font-black text-rose-ink">{t('qaAdminEvidenceExcerpts')}</h4>
                        <p className="mt-0.5 text-xs font-bold text-rose-key">{t('qaAdminEvidenceHint')}</p>
                        <ol className="mt-2 space-y-2">
                          {citations.map((citation) => (
                            <li key={citation.id} className="rounded-xl border border-rose-line bg-white px-3 py-2 text-xs leading-5 text-rose-key">
                              <span className="mr-1 font-black text-rose-accent-deep">[{citation.ordinal + 1}]</span>
                              {citation.excerpt}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void requestDraft()}
                        disabled={actionsDisabled}
                        className="min-h-11 rounded-full border border-rose-line bg-white px-4 py-2 text-sm font-bold text-rose-key transition hover:border-rose-accent hover:text-rose-accent disabled:opacity-50"
                      >
                        {t('qaAdminRegenerateDraft')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveBody()}
                        disabled={actionsDisabled}
                        className="min-h-11 rounded-full border border-rose-accent/60 bg-white px-4 py-2 text-sm font-bold text-rose-accent transition disabled:opacity-50"
                      >
                        {busy === 'save' ? t('qaSaving') : t('qaAdminSaveDraft')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approve()}
                        disabled={actionsDisabled}
                        className="min-h-11 rounded-full bg-rose-accent-deep px-4 py-2 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
                      >
                        {busy === 'approve' ? t('qaPublishing') : t('qaAdminApprovePublish')}
                      </button>
                    </div>
                    <p className="text-right text-xs font-bold leading-5 text-rose-accent-deep">{t('qaAdminApprovalWarning')}</p>
                  </section>
                ) : (
                  <section className="rounded-2xl border border-dashed border-rose-line bg-rose-bg/70 p-4">
                    <p className="text-sm font-bold leading-6 text-rose-key">
                      {selectedQuestion.status === 'drafting'
                        ? t('qaAdminDraftingHint')
                        : selectedQuestion.status === 'rejected'
                          ? t('qaAdminRejectedHint')
                          : t('qaAdminNoDraftHint')}
                    </p>
                    {(['submitted', 'failed', 'drafting'] as QaQuestionStatus[]).includes(selectedQuestion.status) && (
                      <button
                        type="button"
                        onClick={() => void requestDraft(selectedQuestion.status === 'drafting')}
                        disabled={actionsDisabled}
                        className="mt-3 min-h-11 rounded-full bg-rose-accent-deep px-4 py-2 text-sm font-extrabold text-white shadow-sm shadow-rose-accent/25 transition active:scale-[0.98] disabled:opacity-50"
                      >
                        {busy === 'draft'
                          ? t('qaAdminRequestingDraft')
                            : selectedQuestion.status === 'drafting'
                              ? t('qaAdminRecoverDraft')
                              : selectedQuestion.status === 'failed'
                            ? t('qaAdminRetryDraft')
                            : t('qaAdminRequestDraft')}
                      </button>
                    )}
                  </section>
                )}

                {selectedQuestion.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => void reopen()}
                    disabled={actionsDisabled}
                    className="min-h-11 rounded-full border border-rose-accent/60 bg-white px-4 py-2 text-sm font-bold text-rose-accent transition disabled:opacity-50"
                  >
                    {busy === 'reopen' ? t('qaReopening') : t('qaAdminReopen')}
                  </button>
                )}

                {['submitted', 'failed', 'draft_ready'].includes(selectedQuestion.status) && (
                  <section className="rounded-2xl border border-rose-line bg-rose-card p-3">
                    <label className="block space-y-1.5">
                      <span className="block text-sm font-black text-rose-ink">{t('qaAdminRejectReason')}</span>
                      <textarea
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder={t('qaAdminRejectPlaceholder')}
                        className="block w-full resize-y rounded-xl border border-rose-line bg-white p-3 text-base leading-6 text-rose-ink outline-none focus:border-rose-accent focus:ring-2 focus:ring-rose-accent"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void reject()}
                      disabled={actionsDisabled}
                      className="mt-2 min-h-11 rounded-full border border-rose-accent/50 bg-white px-4 py-2 text-sm font-bold text-rose-accent transition hover:bg-rose-accent hover:text-white disabled:opacity-50"
                    >
                      {busy === 'reject' ? t('qaRejecting') : t('qaAdminReject')}
                    </button>
                  </section>
                )}

                {revisions.length > 0 && (
                  <details className="rounded-xl border border-rose-line bg-rose-bg/60">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-bold text-rose-key focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-accent">
                      <span>{t('qaAdminRevisionHistory')}</span>
                      <span>{revisions.length}</span>
                    </summary>
                    <ol className="space-y-1 border-t border-rose-line px-3 py-2">
                      {revisions.map((revision) => (
                        <li key={revision.id} className="flex items-center justify-between gap-3 text-xs font-bold text-rose-key">
                          <span>{t('qaAdminRevision')(revision.revisionNumber)}</span>
                          <span>{formatQaDate(revision.createdAt)}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

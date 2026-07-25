import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n/strings'

function HelpIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
      />
    </svg>
  )
}

/** 가이드 한 단락 */
function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rose-line/70 pt-3.5 first:border-t-0 first:pt-0">
      <h3 className="mb-1 flex items-center gap-2 font-serif text-base font-bold text-rose-ink">
        <span aria-hidden>{icon}</span>
        {title}
      </h3>
      <div className="space-y-1 text-[14px] leading-relaxed text-rose-key">{children}</div>
    </section>
  )
}

function GuideModal({ onClose }: { onClose: () => void }) {
  // 열려있는 동안 Esc 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // Portal로 body에 직접 렌더 — 헤더의 backdrop-filter 등에 fixed가 갇혀 잘리는 것 방지
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-rose-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('guideAria')}
      >
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between border-b border-rose-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-serif text-lg font-extrabold text-rose-ink">
            <HelpIcon className="h-5 w-5 text-rose-accent" />
            {t('guideTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('guideClose')}
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-rose-key/70 hover:bg-rose-chip/60 hover:text-rose-accent"
          >
            ✕
          </button>
        </div>

        {/* 내용 (스크롤) */}
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="rounded-xl bg-rose-chip/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-ink">
            {t('guideIntro')}
          </p>

          <Section icon="✏️" title={t('guideStartTitle')}>
            <p>{t('guideStart1')}</p>
            <p>{t('guideStart2')}</p>
          </Section>

          <Section icon="📖" title={t('guidePassageTitle')}>
            <p>{t('guidePassage1')}</p>
            <p>{t('guidePassage2')}</p>
          </Section>

          <Section icon="🖊️" title={t('guideWritingTitle')}>
            <p>{t('guideWriting1')}</p>
            <p>{t('guideWriting2')}</p>
            <p>{t('guideWriting3')}</p>
            <p>{t('guideWriting4')}</p>
          </Section>

          <Section icon="🗂️" title={t('guideTabsTitle')}>
            <p>{t('guideTabs1')}</p>
            <p>{t('guideTabs2')}</p>
          </Section>

          <Section icon="📤" title={t('guideShareTitle')}>
            <p>{t('guideShare1')}</p>
          </Section>

          <Section icon="📱" title={t('guideAppTitle')}>
            <p>{t('guideApp1')}</p>
          </Section>

          <Section icon="💾" title={t('guideSaveTitle')}>
            <p>{t('guideSave1')}</p>
            <p>{t('guideSave2')}</p>
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 어디서든 놓을 수 있는 가이드 버튼 + 팝업.
 * className으로 위치(예: absolute ...)만 덧붙이고, 모양은 공통(아이콘+사용법 pill)으로 유지.
 */
export default function GuideButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={t('guideOpen')}
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1 rounded-full bg-rose-chip/80 px-2.5 py-1 text-[13px] font-semibold text-rose-key transition active:scale-95 ${className}`}
      >
        <HelpIcon />
        {t('guideUsage')}
      </button>
      {open && <GuideModal onClose={() => setOpen(false)} />}
    </>
  )
}

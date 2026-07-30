import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import LangToggle from '../components/LangToggle'
import { getLang } from '../i18n/lang'
import { t } from '../i18n/strings'

interface CardDef {
  to: string
  title: string
  description: string
  emblem: ReactNode
}

function NoteEmblem() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" className="h-10 w-10" aria-hidden>
      <rect x="9" y="5" width="22" height="30" rx="2" strokeWidth="1.5" />
      <path d="M13 5v30" strokeWidth="1" opacity="0.4" />
      <path d="M17 13h9M17 18h11M17 23h8" strokeWidth="1.3" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

function SermonEmblem() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" className="h-10 w-10" aria-hidden>
      <path
        d="M20 12c-3-2-8-2-14-1v22c6-1 11-1 14 1 3-2 8-2 14-1V11c-6-1-11-1-14 1z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M20 12v22" strokeWidth="1" opacity="0.45" />
    </svg>
  )
}

function BinderEmblem() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10" aria-hidden>
      <rect x="10" y="5" width="22" height="30" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="5" width="4.5" height="30" fill="currentColor" opacity="0.85" />
      <circle cx="12.25" cy="11" r="1" fill="var(--color-rose-chip)" />
      <circle cx="12.25" cy="20" r="1" fill="var(--color-rose-chip)" />
      <circle cx="12.25" cy="29" r="1" fill="var(--color-rose-chip)" />
    </svg>
  )
}

function QaEmblem() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" className="h-10 w-10" aria-hidden>
      <path d="M7 9.5h26v18H18l-7 5v-5H7z" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15.5 16.5a4.5 4.5 0 0 1 8.2 2.6c0 2.4-3.7 2.6-3.7 5" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="20" cy="27" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function LandingPage() {
  const isEn = getLang() === 'en'
  const cards: CardDef[] = [
    {
      to: '/note',
      title: t('landingNoteTitle'),
      description: t('landingNoteDesc'),
      emblem: <NoteEmblem />,
    },
    {
      to: '/sermon',
      title: t('landingSermonTitle'),
      description: t('landingSermonDesc'),
      emblem: <SermonEmblem />,
    },
    {
      to: '/binder',
      title: t('landingBinderTitle'),
      description: t('landingBinderDesc'),
      emblem: <BinderEmblem />,
    },
    {
      to: '/qa',
      title: t('landingQaTitle'),
      description: t('landingQaDesc'),
      emblem: <QaEmblem />,
    },
  ]

  return (
    <div className="relative min-h-full overflow-hidden bg-rose-bg px-5 pb-16 pt-12 text-rose-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-24 h-80 w-80 rounded-full bg-rose-accent/[0.07] blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-rose-chip/60 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[10%] top-[38%] h-24 w-24 rounded-full bg-rose-accent/[0.05] blur-xl"
      />

      <div className="absolute right-4 top-4 z-10">
        <LangToggle />
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col items-center">
        <section
          className="relative w-full pb-8 pt-6 text-center"
          style={{ animation: 'fadeIn 0.55s ease both' }}
        >
          <p className="font-serif text-[11px] tracking-[0.42em] text-rose-key">
            {t('landingEyebrow')}
          </p>
          <div className="my-6 flex items-center justify-center gap-3 text-rose-accent/70">
            <span className="h-px w-9 bg-rose-line" />
            <span className="text-base">✦</span>
            <span className="h-px w-9 bg-rose-line" />
          </div>
          <h1 className="font-serif text-[2.4rem] font-extrabold leading-[1.1] tracking-tight text-rose-ink">
            {t('landingTitle')}
          </h1>
          <p className="mt-3 font-serif text-sm tracking-wide text-rose-key">
            {t('landingSubtitle')}
          </p>
        </section>

        <ul className="w-full space-y-3.5">
          {cards.map((card, index) => (
            <li
              key={card.to}
              style={{
                animation: 'fadeIn 0.5s ease both',
                animationDelay: `${120 + index * 90}ms`,
              }}
            >
              <Link
                to={card.to}
                className="group flex min-h-[84px] items-center gap-4 rounded-[22px] border border-rose-line bg-rose-card px-5 py-4 shadow-sm transition hover:border-rose-accent hover:shadow-lift active:scale-[0.99]"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-rose-chip text-rose-accent-deep transition group-hover:bg-rose-accent/10">
                  {card.emblem}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-[17px] font-extrabold leading-tight text-rose-ink">
                    {card.title}
                  </span>
                  <span className="mt-1 block text-[13px] leading-5 text-rose-key">
                    {card.description}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="flex shrink-0 items-center gap-1.5 text-[10px] font-black tracking-[0.24em] text-rose-key/70 transition group-hover:text-rose-accent"
                >
                  {t('landingEnter')}
                  <span className="text-base leading-none">›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div
          className="mt-12 flex w-full flex-col items-center text-center"
          style={{ animation: 'fadeIn 0.7s ease both', animationDelay: '420ms' }}
        >
          {isEn ? (
            <blockquote className="max-w-xs font-serif text-[14px] leading-7 text-rose-key/85">
              “Ponder and meditate on it day and night,
              <br />making sure you practice everything written in it.”
              <footer className="mt-1.5 text-xs text-rose-key/60">— Joshua 1:8</footer>
            </blockquote>
          ) : (
            <blockquote className="max-w-xs font-serif text-[14px] leading-7 text-rose-key/85">
              “이 율법책을 네 입에서 떠나지 말게 하며
              <br />주야로 그것을 묵상하라”
              <footer className="mt-1.5 text-xs text-rose-key/60">— 여호수아 1:8</footer>
            </blockquote>
          )}
          <p className="mt-8 font-mono text-[10px] text-rose-key/40">v{__BUILD__}</p>
        </div>
      </div>
    </div>
  )
}

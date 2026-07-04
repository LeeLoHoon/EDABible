import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

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
        aria-label="사용 가이드"
      >
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between border-b border-rose-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-serif text-lg font-extrabold text-rose-ink">
            <HelpIcon className="h-5 w-5 text-rose-accent" />
            사용 가이드
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-rose-key/70 hover:bg-rose-chip/60 hover:text-rose-accent"
          >
            ✕
          </button>
        </div>

        {/* 내용 (스크롤) */}
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="rounded-xl bg-rose-chip/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-rose-ink">
            매일 성경 본문을 <b>읽고 · 필사하고 · 묵상</b>하는 노트예요. 작성한 내용은 자동으로
            저장됩니다.
          </p>

          <Section icon="✏️" title="묵상 시작">
            <p>홈에서 “오늘 묵상 시작”을 누르면 오늘 날짜의 묵상이 만들어져요.</p>
            <p>이미 쓴 묵상은 목록에서 눌러 이어서 작성할 수 있습니다.</p>
          </Section>

          <Section icon="📖" title="본문 선택">
            <p>성경과 장/편을 고르면 위에 본문이 나와요. 본문을 읽으며 아래 칸에 필사하세요.</p>
            <p>본문 구절을 탭하면 <b>형광 밑줄</b>로 표시해 둘 수 있어요. 다시 탭하면 지워집니다.</p>
          </Section>

          <Section icon="🖊️" title="필사 — 손글씨 · 타이핑">
            <p>오른쪽 위 토글로 <b>손글씨</b> / <b>타이핑</b>을 전환합니다.</p>
            <p>
              손글씨는 <b>애플펜슬(스타일러스) 전용</b>이라, 쓰는 동안 손바닥이 화면에 닿아도
              괜찮아요.
            </p>
            <p>펜 색 5가지 · 굵기 조절 · 지우개(획 단위) · ↩️ 취소 · 전체 지우기를 쓸 수 있어요.</p>
            <p>
              칸이 부족하면 <b>“+ 공간 늘리기”</b>를 눌러 아래로 더 넓게 쓰세요. (지난 필기는 다시
              열어도 그대로 보입니다.)
            </p>
          </Section>

          <Section icon="🗂️" title="네 가지 탭">
            <p>아래 탭으로 이동해요: 📖 필사 · 🙏 기도 · ❓ 5가지 질문 · 🛡️ 승리.</p>
            <p>각 탭은 따로 저장되며, 원하는 것만 채워도 됩니다.</p>
          </Section>

          <Section icon="📤" title="이미지로 공유">
            <p>상단 <b>공유</b> 버튼을 누르고, 공유할 탭을 고른 뒤 “JPG 공유”를 누르면 한 장의
              이미지로 저장·공유됩니다.</p>
          </Section>

          <Section icon="📱" title="앱처럼 쓰기">
            <p>
              Safari에서 <b>공유 → “홈 화면에 추가”</b>를 하면, 주소창 없는 전체화면 앱처럼 쓸 수
              있어요. (펜 입력도 더 쾌적합니다.)
            </p>
          </Section>

          <Section icon="💾" title="저장 · 삭제">
            <p>작성 즉시 <b>이 기기에 자동 저장</b>됩니다.</p>
            <p>지우려면 홈 목록에서 항목 오른쪽 ✕ 를 누르세요.</p>
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
        aria-label="사용 가이드 열기"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1 rounded-full bg-rose-chip/80 px-2.5 py-1 text-[13px] font-semibold text-rose-key transition active:scale-95 ${className}`}
      >
        <HelpIcon />
        사용법
      </button>
      {open && <GuideModal onClose={() => setOpen(false)} />}
    </>
  )
}

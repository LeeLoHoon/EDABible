import { Link } from 'react-router-dom'

interface BackButtonProps {
  /** 라우팅 목적지 — 지정하면 Link, 없으면 button으로 렌더한다. */
  to?: string
  /** 저장 후 이동처럼 단순 이동이 아닌 경우에 사용한다. */
  onClick?: () => void
  label: string
  disabled?: boolean
  className?: string
}

/** 모든 화면에서 같은 모양·같은 자리로 쓰는 뒤로 가기 버튼. 화살표는 여기서만 붙인다. */
const BASE =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-rose-line bg-rose-card/80 px-3.5 text-sm font-bold text-rose-key shadow-sm transition hover:border-rose-accent hover:text-rose-accent active:scale-95 focus:outline-none focus:ring-2 focus:ring-rose-accent'

const DISABLED =
  'disabled:cursor-not-allowed disabled:text-rose-key/40 disabled:hover:border-rose-line disabled:hover:text-rose-key/40 disabled:active:scale-100'

export default function BackButton({
  to,
  onClick,
  label,
  disabled = false,
  className = '',
}: BackButtonProps) {
  const content = (
    <>
      <span aria-hidden>←</span>
      {label}
    </>
  )
  const classes = `${BASE} ${className}`.trim()

  if (to && !disabled) {
    return (
      <Link to={to} onClick={onClick} className={classes}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`${classes} ${DISABLED}`}
    >
      {content}
    </button>
  )
}

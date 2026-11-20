import type { SegmentMode } from '../engine/types'

type P = { size?: number; className?: string }

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
  focusable: false,
})

export const Car = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M5 17h14v-5l-2-5H7l-2 5z" />
    <path d="M5 12h14" />
    <circle cx="8" cy="17" r="1.6" />
    <circle cx="16" cy="17" r="1.6" />
  </svg>
)
export const Train = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="6" y="3" width="12" height="13" rx="3" />
    <path d="M6 10h12M9 20l-1.5 2M15 20l1.5 2M9 13.5h.01M15 13.5h.01" />
  </svg>
)
export const Bus = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="5" y="3" width="14" height="15" rx="2.5" />
    <path d="M5 11h14M8 18v2M16 18v2M8.5 14.5h.01M15.5 14.5h.01" />
  </svg>
)
export const Walk = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="13" cy="4" r="1.6" />
    <path d="M10 21l2-6 3 3v3M9 12l2-4 3 2 3 1M11 8l-2 5" />
  </svg>
)
export const Ferry = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M3 17c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M5 14l1-5h12l1 5M9 9V6h6v3" />
  </svg>
)
export const Tram = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="6" y="6" width="12" height="11" rx="2.5" />
    <path d="M12 6V3M9 3h6M8 20l1.5-3M16 20l-1.5-3M6 12h12" />
  </svg>
)
export const Park = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
  </svg>
)
export const Clock = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
)
export const Gear = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
)
export const Plus = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const X = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const Up = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 15l6-6 6 6" />
  </svg>
)
export const Down = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)
export const Pin = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
)
export const Alert = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5h.01" />
  </svg>
)
export const Info = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)
export const Rain = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M7 15a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 15z" />
    <path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
  </svg>
)
export const Sun = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
export const Edit = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </svg>
)

export function ModeIcon({ mode, size = 18 }: { mode: SegmentMode; size?: number }) {
  switch (mode) {
    case 'drive':
      return <Car size={size} />
    case 'rail':
    case 'metro':
      return <Train size={size} />
    case 'bus':
      return <Bus size={size} />
    case 'tram':
      return <Tram size={size} />
    case 'ferry':
      return <Ferry size={size} />
    case 'park':
      return <Park size={size} />
    case 'wait':
      return <Clock size={size} />
    default:
      return <Walk size={size} />
  }
}

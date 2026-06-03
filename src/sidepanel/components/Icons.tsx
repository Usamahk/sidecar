import type { SVGProps } from 'react'

interface IcoProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'stroke' | 'fill'> {
  size?: number
  stroke?: number
  d?: string
  fill?: string
  children?: React.ReactNode
}

function Ico({ size = 18, stroke = 1.6, d, fill = 'none', children, ...rest }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {d ? <path d={d} /> : children}
    </svg>
  )
}

interface LogoMarkProps {
  size?: number
  accent?: string
  ink?: string
}

// Top-down motorcycle + sidecar. Bike body is an empty outline;
// the sidecar pod is filled in the accent color.
export function LogoMark({ size = 22, accent = 'var(--accent)', ink = 'currentColor' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={ink}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6.5" y="5.5" width="8" height="21.5" rx="4" fill="none" />
      <rect x="9.2" y="2.8" width="2.6" height="4.4" rx="1.3" fill={ink} stroke="none" />
      <rect x="9.2" y="25.3" width="2.6" height="4.4" rx="1.3" fill={ink} stroke="none" />
      <line x1="4" y1="10.5" x2="17" y2="10.5" />
      <line x1="14.5" y1="14" x2="18" y2="14.5" />
      <line x1="14.5" y1="20.5" x2="18" y2="20" />
      <path
        d="M22 10.5 C 25.4 10.5 26.5 13 26.5 16 L 26.5 19 C 26.5 22 24.6 23.5 22 23.5 C 19.4 23.5 17.5 22 17.5 19 L 17.5 15 C 17.5 12 18.8 10.5 22 10.5 Z"
        fill={accent}
      />
      <line x1="28" y1="15.5" x2="28" y2="18.5" />
    </svg>
  )
}

interface WordmarkProps {
  size?: number
  showMark?: boolean
}

export function Wordmark({ size = 22, showMark = true }: WordmarkProps) {
  return (
    <span className="inline-flex items-center gap-2 leading-none">
      {showMark && <LogoMark size={size} />}
      <span
        className="font-serif text-ink"
        style={{ fontSize: size * 0.92, lineHeight: 1, letterSpacing: '0.005em' }}
      >
        Sidecar
      </span>
    </span>
  )
}

type IconComponent = (p?: Omit<IcoProps, 'd' | 'children'>) => JSX.Element

export const Icons: Record<string, IconComponent> = {
  timeline: (p) => (
    <Ico {...p}>
      <circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="19" y2="6" />
      <line x1="9" y1="12" x2="19" y2="12" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </Ico>
  ),
  themes: (p) => (
    <Ico {...p}>
      <path d="M4 8.5 L11 5 L18 8.5 L11 12 Z" />
      <path d="M4 13.5 L11 17 L18 13.5" />
    </Ico>
  ),
  graph: (p) => (
    <Ico {...p}>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="17.5" cy="6" r="2.2" />
      <circle cx="13" cy="17.5" r="2.2" />
      <line x1="7.8" y1="8.4" x2="11.4" y2="15.6" />
      <line x1="8" y1="7" x2="15.4" y2="6.2" />
      <line x1="16.4" y1="8" x2="13.7" y2="15.4" />
    </Ico>
  ),
  agent: (p) => (
    <Ico {...p}>
      <path d="M5 5.5 H19 A1.5 1.5 0 0 1 20.5 7 V14 A1.5 1.5 0 0 1 19 15.5 H10 L6 19 V15.5 H5 A1.5 1.5 0 0 1 3.5 14 V7 A1.5 1.5 0 0 1 5 5.5 Z" />
      <path d="M12 8 L12.9 10.1 L15 11 L12.9 11.9 L12 14 L11.1 11.9 L9 11 L11.1 10.1 Z" fill="currentColor" stroke="none" />
    </Ico>
  ),
  settings: (p) => (
    <Ico {...p}>
      <line x1="4" y1="7.5" x2="20" y2="7.5" />
      <circle cx="9" cy="7.5" r="2.1" fill="var(--surface-1)" />
      <line x1="4" y1="16.5" x2="20" y2="16.5" />
      <circle cx="15" cy="16.5" r="2.1" fill="var(--surface-1)" />
    </Ico>
  ),
  search: (p) => (
    <Ico {...p}>
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15" y1="15" x2="20" y2="20" />
    </Ico>
  ),
  sort: (p) => (
    <Ico {...p}>
      <line x1="6" y1="5" x2="6" y2="19" />
      <path d="M3 16 L6 19 L9 16" />
      <line x1="13" y1="7" x2="20" y2="7" />
      <line x1="13" y1="12" x2="18" y2="12" />
      <line x1="13" y1="17" x2="16" y2="17" />
    </Ico>
  ),
  add: (p) => (
    <Ico {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Ico>
  ),
  close: (p) => (
    <Ico {...p}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </Ico>
  ),
  image: (p) => (
    <Ico {...p}>
      <rect x="4" y="5.5" width="16" height="13" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M5 16 L10 11.5 L13.5 14.5 L16 12.5 L19 15.5" />
    </Ico>
  ),
  link: (p) => (
    <Ico {...p}>
      <path d="M9 14.5 L15 8.5" />
      <path d="M11 6.5 L13 4.5 A3.2 3.2 0 0 1 17.5 9 L15.5 11" />
      <path d="M13 17.5 L11 19.5 A3.2 3.2 0 0 1 6.5 15 L8.5 13" />
    </Ico>
  ),
  chevron: (p) => <Ico {...p} d="M8 5 L15 12 L8 19" />,
  minus: (p) => <Ico {...p} d="M5 12 H19" />,
  sun: (p) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="3" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21" />
      <line x1="3" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21" y2="12" />
      <line x1="5.6" y1="5.6" x2="7" y2="7" />
      <line x1="17" y1="17" x2="18.4" y2="18.4" />
      <line x1="18.4" y1="5.6" x2="17" y2="7" />
      <line x1="7" y1="17" x2="5.6" y2="18.4" />
    </Ico>
  ),
  moon: (p) => <Ico {...p} d="M19 13.5 A7.5 7.5 0 1 1 10.5 5 A6 6 0 0 0 19 13.5 Z" />,
  monitor: (p) => (
    <Ico {...p}>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <line x1="8" y1="20" x2="16" y2="20" />
      <line x1="12" y1="16.5" x2="12" y2="20" />
    </Ico>
  ),
  scan: (p) => (
    <Ico {...p}>
      <path d="M5 8 V6 A1 1 0 0 1 6 5 H8" />
      <path d="M16 5 H18 A1 1 0 0 1 19 6 V8" />
      <path d="M19 16 V18 A1 1 0 0 1 18 19 H16" />
      <path d="M8 19 H6 A1 1 0 0 1 5 18 V16" />
      <path d="M9.5 9 L12 14.5 L14.5 9" />
    </Ico>
  ),
  check: (p) => <Ico {...p} d="M5 12.5 L10 17 L19 7" />,
}

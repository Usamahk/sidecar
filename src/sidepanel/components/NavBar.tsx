import type { View } from '@/types'

interface NavItem { view: View; icon: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { view: 'timeline', icon: '📋', label: 'Timeline' },
  { view: 'themes',   icon: '🗂️',  label: 'Themes'   },
  { view: 'graph',    icon: '🕸️',  label: 'Graph'    },
  { view: 'agent',    icon: '🤖',  label: 'Agent'    },
  { view: 'settings', icon: '⚙️',  label: 'Settings' },
]

interface Props { current: View; onChange: (view: View) => void }

export function NavBar({ current, onChange }: Props) {
  return (
    <nav className="flex items-center border-t border-line bg-surface-1">
      {NAV_ITEMS.map(({ view, icon, label }) => (
        <button
          key={view}
          onClick={() => onChange(view)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors
            ${current === view ? 'text-accent' : 'text-ink-3 hover:text-ink-2'}`}
          aria-label={label}
        >
          <span className="text-base leading-none">{icon}</span>
          <span className="text-[10px] font-medium">{label}</span>
        </button>
      ))}
    </nav>
  )
}

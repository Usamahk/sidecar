import type { View } from '@/types'
import { Icons } from './Icons'

interface NavItem { view: View; Icon: typeof Icons[string]; label: string }

const NAV_ITEMS: NavItem[] = [
  { view: 'timeline', Icon: Icons.timeline, label: 'Timeline' },
  { view: 'themes',   Icon: Icons.themes,   label: 'Themes'   },
  { view: 'graph',    Icon: Icons.graph,    label: 'Graph'    },
  { view: 'agent',    Icon: Icons.agent,    label: 'Agent'    },
  { view: 'settings', Icon: Icons.settings, label: 'Settings' },
]

interface Props { current: View; onChange: (view: View) => void }

export function NavBar({ current, onChange }: Props) {
  return (
    <nav className="flex items-center border-t border-line bg-surface-1">
      {NAV_ITEMS.map(({ view, Icon, label }) => {
        const active = current === view
        return (
          <button
            key={view}
            onClick={() => onChange(view)}
            className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors
              ${active ? 'text-accent' : 'text-ink-3 hover:text-ink-2'}`}
            aria-label={label}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-[22px] h-[2px] rounded-b bg-accent" />
            )}
            <Icon size={18} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

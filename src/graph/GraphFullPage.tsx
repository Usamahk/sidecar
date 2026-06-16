import { useEffect } from 'react'
import { useTheme, type ThemeMode } from '@/hooks/useTheme'
import { GraphExplorer } from '@/sidepanel/components/GraphExplorer'
import { Wordmark, Icons } from '@/sidepanel/components/Icons'
import { usePopoutHeartbeat } from '@/sidepanel/state/graphPopout'

const MODES: { mode: ThemeMode; Icon: typeof Icons[string]; label: string }[] = [
  { mode: 'light',  Icon: Icons.sun,     label: 'Light'  },
  { mode: 'dark',   Icon: Icons.moon,    label: 'Dark'   },
  { mode: 'system', Icon: Icons.monitor, label: 'System' },
]

export function GraphFullPage() {
  const { mode, setTheme } = useTheme()
  usePopoutHeartbeat()

  useEffect(() => {
    document.title = 'Sidecar — Knowledge graph'
  }, [])

  return (
    <div className="flex flex-col h-screen bg-surface text-ink overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-1 flex-shrink-0">
        <Wordmark size={20} />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 border border-line rounded-full p-0.5">
            {MODES.map(({ mode: m, Icon, label }) => (
              <button
                key={m}
                onClick={() => setTheme(m)}
                title={label}
                aria-label={label}
                className={`p-1 rounded-full transition-colors
                  ${mode === m
                    ? 'bg-surface-2 text-ink'
                    : 'text-ink-3 hover:text-ink-2'
                  }`}
              >
                <Icon size={12} stroke={1.8} />
              </button>
            ))}
          </div>
          <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-3">graph</span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <GraphExplorer variant="fullpage" />
      </main>
    </div>
  )
}

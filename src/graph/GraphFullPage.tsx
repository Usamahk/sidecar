import { useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { GraphExplorer } from '@/sidepanel/components/GraphExplorer'
import { Wordmark } from '@/sidepanel/components/Icons'

export function GraphFullPage() {
  const { mode } = useTheme()

  // Keep the document title in sync; the pop-out is just a Chrome tab.
  useEffect(() => {
    document.title = 'Sidecar — Knowledge graph'
  }, [])

  // The hook sets a class on documentElement; explicit mode prop unused here.
  void mode

  return (
    <div className="flex flex-col h-screen bg-surface text-ink overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-1 flex-shrink-0">
        <Wordmark size={20} />
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-3">graph</span>
      </header>
      <main className="flex-1 overflow-hidden">
        <GraphExplorer variant="fullpage" />
      </main>
    </div>
  )
}

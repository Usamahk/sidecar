import { useState } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { CaptureBar } from './components/CaptureBar'
import { NavBar } from './components/NavBar'
import { TimelineView } from './views/TimelineView'
import { ThemesView } from './views/ThemesView'
import { GraphView } from './views/GraphView'
import { AgentView } from './views/AgentView'
import { SettingsPanel } from './components/SettingsPanel'
import type { View } from '@/types'

export function App() {
  const [view, setView] = useState<View>('timeline')
  const { mode, setTheme } = useTheme()

  return (
    <div className="flex flex-col h-screen bg-surface text-ink overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-1 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔭</span>
          <span className="text-sm font-semibold text-ink">Sidecar</span>
        </div>
        <span className="text-xs text-ink-3 capitalize">{view}</span>
      </header>

      {view === 'timeline' && <CaptureBar />}

      <main className="flex-1 overflow-hidden">
        {view === 'timeline' && <TimelineView />}
        {view === 'themes' && <ThemesView />}
        {view === 'graph' && <GraphView />}
        {view === 'agent' && <AgentView />}
        {view === 'settings' && <SettingsPanel mode={mode} setTheme={setTheme} />}
      </main>

      <NavBar current={view} onChange={setView} />
    </div>
  )
}

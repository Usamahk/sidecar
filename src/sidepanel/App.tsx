import { useState, useEffect } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { requestPersistentStorage } from '@/db/persistence'
import { wireAutoBackupHooks } from '@/db/backup'
import { migrateApiKeyFromSettings } from '@/ai/apiKey'
import { CaptureBar } from './components/CaptureBar'
import { NavBar } from './components/NavBar'
import { Wordmark } from './components/Icons'
import { TimelineView } from './views/TimelineView'
import { ThemesView } from './views/ThemesView'
import { GraphView } from './views/GraphView'
import { ResearchView } from './views/ResearchView'
import { SettingsPanel } from './components/SettingsPanel'
import type { View } from '@/types'

export function App() {
  const [view, setView] = useState<View>('timeline')
  const { mode, setTheme } = useTheme()

  useEffect(() => {
    void requestPersistentStorage()
    void migrateApiKeyFromSettings()
    wireAutoBackupHooks()
  }, [])

  return (
    <div className="flex flex-col h-screen bg-surface text-ink overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-1 flex-shrink-0">
        <Wordmark size={20} />
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-3">{view}</span>
      </header>

      {view === 'timeline' && <CaptureBar />}

      <main className="flex-1 overflow-hidden">
        {view === 'timeline' && <TimelineView />}
        {view === 'themes' && <ThemesView />}
        {view === 'graph' && <GraphView onChangeView={setView} />}
        {view === 'research' && <ResearchView />}
        {view === 'settings' && <SettingsPanel mode={mode} setTheme={setTheme} />}
      </main>

      <NavBar current={view} onChange={setView} />
    </div>
  )
}

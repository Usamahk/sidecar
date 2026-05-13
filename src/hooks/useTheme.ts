import { useState, useEffect } from 'react'
import { db } from '@/db/schema'

export type ThemeMode = 'dark' | 'light' | 'system'

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>('dark')

  // Load persisted setting on mount
  useEffect(() => {
    db.settings.get('themeMode').then((s) => {
      const saved = (s?.value ?? 'dark') as ThemeMode
      setModeState(saved)
      applyTheme(saved)
    })
  }, [])

  // Re-apply whenever mode changes, and watch system changes if needed
  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  function setTheme(m: ThemeMode) {
    applyTheme(m)
    setModeState(m)
    db.settings.put({ key: 'themeMode', value: m })
  }

  return { mode, setTheme }
}

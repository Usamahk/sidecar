import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'

export type ThemeMode = 'dark' | 'light' | 'system'

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

// Live-queried so multiple tabs (the side panel + the graph pop-out) stay in
// sync — Dexie's liveQuery broadcasts changes across same-origin tabs.
export function useTheme() {
  const row = useLiveQuery(() => db.settings.get('themeMode'), [])
  const mode = (row?.value ?? 'dark') as ThemeMode

  useEffect(() => {
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  function setTheme(m: ThemeMode) {
    // Apply locally right away so the click feels instant; the persisted write
    // then broadcasts the change to any other open tabs.
    applyTheme(m)
    void db.settings.put({ key: 'themeMode', value: m })
  }

  return { mode, setTheme }
}

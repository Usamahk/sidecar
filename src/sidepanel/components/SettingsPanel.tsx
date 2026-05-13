import { useState, useEffect } from 'react'
import { saveAs } from 'file-saver'
import { db } from '@/db/schema'
import { exportAllData } from '@/db/items'
import type { ThemeMode } from '@/hooks/useTheme'

const THEME_OPTIONS: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: 'dark',   icon: '🌙', label: 'Dark'   },
  { mode: 'light',  icon: '☀️', label: 'Light'  },
  { mode: 'system', icon: '💻', label: 'System' },
]

interface SettingsPanelProps {
  mode: ThemeMode
  setTheme: (m: ThemeMode) => void
}

export function SettingsPanel({ mode, setTheme }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    db.settings.get('anthropicApiKey').then((s) => { if (s?.value) setApiKey(s.value) })
  }, [])

  async function saveApiKey() {
    await db.settings.put({ key: 'anthropicApiKey', value: apiKey })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleExportJSON() {
    const data = await exportAllData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    saveAs(blob, `sidecar-export-${new Date().toISOString().slice(0, 10)}.json`)
  }

  async function handleExportMarkdown() {
    const items = await db.items.toArray()
    const md = items.map((item) => [
      `---`, `url: ${item.url}`, `date: ${item.date}`,
      `captured: ${new Date(item.createdAt).toISOString()}`, `---`, ``,
      item.content, item.notes ? `\n> **Notes:** ${item.notes}` : '', ``, `---`,
    ].join('\n')).join('\n\n')
    saveAs(new Blob([md], { type: 'text/markdown' }), `sidecar-export-${new Date().toISOString().slice(0, 10)}.md`)
  }

  async function handleClearAll() {
    if (!confirm('Delete all captured items? This cannot be undone.')) return
    await Promise.all([db.items.clear(), db.edges.clear(), db.concepts.clear(), db.attachments.clear()])
  }

  const sectionTitle = 'text-sm font-semibold text-ink mb-3'
  const card = 'w-full px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-strong text-ink-2 text-sm rounded-lg transition-colors text-left flex items-center gap-2'

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-6">

      {/* Appearance */}
      <div>
        <h2 className={sectionTitle}>Appearance</h2>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ mode: m, icon, label }) => (
            <button
              key={m}
              onClick={() => setTheme(m)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-colors
                ${mode === m
                  ? 'bg-accent/10 border-accent text-accent'
                  : 'bg-surface-2 border-line text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        {mode === 'system' && (
          <p className="text-xs text-ink-3 mt-2">Matches your OS appearance setting automatically.</p>
        )}
      </div>

      {/* AI Agent */}
      <div>
        <h2 className={sectionTitle}>AI Agent</h2>
        <label className="block text-xs text-ink-3 mb-1.5">Anthropic API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full bg-surface-2 border border-line focus:border-line-strong rounded-lg px-3 py-2
            text-sm text-ink placeholder-ink-3 outline-none transition-colors mb-2"
        />
        <button onClick={saveApiKey}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs rounded-lg transition-colors font-medium">
          {saved ? '✓ Saved' : 'Save Key'}
        </button>
        <p className="text-xs text-ink-3 mt-2">Stored locally in Chrome — never leaves your browser.</p>
      </div>

      {/* Export */}
      <div>
        <h2 className={sectionTitle}>Export</h2>
        <div className="space-y-2">
          <button onClick={handleExportJSON} className={card}>
            <span>📦</span>
            <div>
              <div className="font-medium text-xs text-ink">Export JSON</div>
              <div className="text-ink-3 text-xs">Full backup including all data</div>
            </div>
          </button>
          <button onClick={handleExportMarkdown} className={card}>
            <span>📝</span>
            <div>
              <div className="font-medium text-xs text-ink">Export Markdown</div>
              <div className="text-ink-3 text-xs">Obsidian-compatible vault format</div>
            </div>
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div>
        <h2 className={sectionTitle}>Danger Zone</h2>
        <button onClick={handleClearAll}
          className="w-full px-3 py-2 bg-surface-2 hover:bg-red-50 dark:hover:bg-red-950
            border border-line hover:border-red-300 dark:hover:border-red-900
            text-red-500 text-xs rounded-lg transition-colors font-medium">
          Clear All Items
        </button>
      </div>
    </div>
  )
}

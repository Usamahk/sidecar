import { useState, useEffect, useRef } from 'react'
import { saveAs } from 'file-saver'
import { db } from '@/db/schema'
import {
  exportAllData,
  importAllData,
  summarize,
  validateBackup,
  type BackupPayload,
  type ImportSummary,
} from '@/db/items'
import {
  connectBackupFolder,
  disconnectBackupFolder,
  backupNow,
  readSnapshotFromFolder,
  subscribeBackupStatus,
  getBackupStatus,
  type BackupStatus,
} from '@/db/backup'
import { getPersistStatus, type PersistStatus } from '@/db/persistence'
import { DEFAULT_SCAN_MODEL } from '@/ai/scan'
import type { ThemeMode } from '@/hooks/useTheme'
import type { Setting } from '@/types'

const SCAN_MODELS: { id: string; label: string; hint: string }[] = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Recommended · stronger clustering' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', hint: 'Cheaper, faster · rougher proposals' },
]

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
  const [scanModel, setScanModel] = useState(DEFAULT_SCAN_MODEL)

  const [pendingImport, setPendingImport] = useState<BackupPayload | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<ImportSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [backupStatus, setBackupStatus] = useState<BackupStatus>({
    connected: false, folderName: null, lastWriteAt: null, isWriting: false, permissionLost: false,
  })
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)

  const [persistStatus, setPersistStatus] = useState<PersistStatus>('transient')

  useEffect(() => {
    db.settings.get('anthropicApiKey').then((s: Setting | undefined) => { if (s?.value) setApiKey(s.value) })
    db.settings.get('scanModel').then((s: Setting | undefined) => { if (s?.value) setScanModel(s.value) })
    getPersistStatus().then(setPersistStatus)
    getBackupStatus().then(setBackupStatus)
    const unsub = subscribeBackupStatus(() => { getBackupStatus().then(setBackupStatus) })
    return unsub
  }, [])

  async function saveApiKey() {
    await db.settings.put({ key: 'anthropicApiKey', value: apiKey })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleModelChange(id: string) {
    setScanModel(id)
    await db.settings.put({ key: 'scanModel', value: id })
  }

  async function handleExportJSON() {
    const data = await exportAllData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    saveAs(blob, `sidecar-export-${new Date().toISOString().slice(0, 10)}.json`)
  }

  async function handleExportMarkdown() {
    const items = await db.items.toArray()
    const md = items.map((item: any) => [
      `---`, `url: ${item.url}`, `date: ${item.date}`,
      `captured: ${new Date(item.createdAt).toISOString()}`, `---`, ``,
      item.content, item.notes ? `\n> **Notes:** ${item.notes}` : '', ``, `---`,
    ].join('\n')).join('\n\n')
    saveAs(new Blob([md], { type: 'text/markdown' }), `sidecar-export-${new Date().toISOString().slice(0, 10)}.md`)
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    setImportDone(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const payload = validateBackup(parsed)
      setPendingImport(payload)
    } catch (err) {
      setImportError((err as Error).message || 'Could not read file')
    }
  }

  async function handleRestoreFromFolder() {
    setImportError(null)
    setImportDone(null)
    try {
      const payload = await readSnapshotFromFolder()
      if (!payload) {
        setImportError('No sidecar-snapshot.json found in the connected folder.')
        return
      }
      setPendingImport(payload)
    } catch (err) {
      setImportError((err as Error).message || 'Could not read snapshot')
    }
  }

  async function confirmImport() {
    if (!pendingImport) return
    setImporting(true)
    try {
      const summary = await importAllData(pendingImport)
      setImportDone(summary)
      setPendingImport(null)
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  async function handleConnectFolder() {
    setBackupError(null)
    setBackupBusy(true)
    try {
      const res = await connectBackupFolder()
      if (!res.ok) setBackupError(res.error)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleDisconnectFolder() {
    if (!confirm('Disconnect backup folder? Your data stays here, but auto-backup stops.')) return
    await disconnectBackupFolder()
  }

  async function handleBackupNow() {
    setBackupError(null)
    setBackupBusy(true)
    try { await backupNow() } finally { setBackupBusy(false) }
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

        <label className="block text-xs text-ink-3 mt-4 mb-1.5">Scan model</label>
        <div className="space-y-1.5">
          {SCAN_MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModelChange(m.id)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors
                ${scanModel === m.id
                  ? 'bg-accent/10 border-accent'
                  : 'bg-surface-2 border-line hover:border-line-strong'
                }`}
            >
              <div className="min-w-0">
                <div className={`text-xs font-medium ${scanModel === m.id ? 'text-accent' : 'text-ink'}`}>
                  {m.label}
                </div>
                <div className="text-[11px] text-ink-3">{m.hint}</div>
              </div>
              {scanModel === m.id && <span className="text-accent text-xs">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Backup */}
      <div>
        <h2 className={sectionTitle}>Backup</h2>

        {backupStatus.connected ? (
          <div className="space-y-2">
            <div className="px-3 py-2 bg-surface-2 border border-line rounded-lg">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-ink truncate">
                  📁 {backupStatus.folderName}
                </span>
                <span className={`text-[10px] flex-shrink-0 ${backupStatus.permissionLost ? 'text-red-400' : 'text-ink-3'}`}>
                  {backupStatus.permissionLost
                    ? 'access lost'
                    : backupStatus.isWriting
                      ? 'saving…'
                      : backupStatus.lastWriteAt
                        ? `saved ${formatAgo(backupStatus.lastWriteAt)}`
                        : 'no snapshot yet'}
                </span>
              </div>
              <p className="text-[11px] text-ink-3">
                Auto-saves <code className="text-ink-2">sidecar-snapshot.json</code> on every change.
                Point at iCloud / Dropbox / Drive for free sync.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleBackupNow} disabled={backupBusy}
                className="flex-1 px-3 py-1.5 text-xs text-ink-2 border border-line hover:border-line-strong rounded-lg transition-colors disabled:opacity-50">
                Save now
              </button>
              {backupStatus.permissionLost && (
                <button onClick={handleConnectFolder} disabled={backupBusy}
                  className="flex-1 px-3 py-1.5 text-xs text-accent border border-accent rounded-lg transition-colors disabled:opacity-50">
                  Reconnect
                </button>
              )}
              <button onClick={handleDisconnectFolder}
                className="px-3 py-1.5 text-xs text-ink-3 hover:text-red-500 transition-colors">
                Disconnect
              </button>
            </div>
            <button onClick={handleRestoreFromFolder}
              className={card}>
              <span>♻️</span>
              <div>
                <div className="font-medium text-xs text-ink">Restore from folder</div>
                <div className="text-ink-3 text-xs">Replace local data with the snapshot</div>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button onClick={handleConnectFolder} disabled={backupBusy}
              className="w-full px-3 py-2 bg-accent hover:opacity-90 text-white text-sm rounded-lg transition-opacity disabled:opacity-50">
              Connect backup folder
            </button>
            <p className="text-[11px] text-ink-3">
              Pick a folder (e.g. an iCloud / Dropbox / Drive folder) and Sidecar will save a snapshot there
              on every change. This survives clearing site data.
            </p>
          </div>
        )}

        {backupError && (
          <p className="text-[11px] text-red-400 mt-2">{backupError}</p>
        )}

        <div className="text-[10px] text-ink-3 mt-3">
          Browser storage:{' '}
          <span className={persistStatus === 'persistent' ? 'text-ink-2' : 'text-ink-3'}>
            {persistStatus === 'persistent' && 'persistent (survives low-disk eviction)'}
            {persistStatus === 'transient' && 'transient (can be evicted by browser)'}
            {persistStatus === 'unsupported' && 'persist API not supported'}
            {persistStatus === 'error' && 'could not check'}
          </span>
        </div>
      </div>

      {/* Import / Export */}
      <div>
        <h2 className={sectionTitle}>Import &amp; Export</h2>
        <div className="space-y-2">
          <button onClick={handleExportJSON} className={card}>
            <span>📦</span>
            <div>
              <div className="font-medium text-xs text-ink">Export JSON</div>
              <div className="text-ink-3 text-xs">Full backup including attachments</div>
            </div>
          </button>
          <button onClick={handleExportMarkdown} className={card}>
            <span>📝</span>
            <div>
              <div className="font-medium text-xs text-ink">Export Markdown</div>
              <div className="text-ink-3 text-xs">Obsidian-compatible vault format</div>
            </div>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className={card}>
            <span>📥</span>
            <div>
              <div className="font-medium text-xs text-ink">Import JSON</div>
              <div className="text-ink-3 text-xs">Replace local data with a backup file</div>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFilePick}
          />
        </div>

        {importError && (
          <p className="text-[11px] text-red-400 mt-2">{importError}</p>
        )}
        {importDone && (
          <div className="mt-2 px-3 py-2 bg-accent/10 border border-accent/30 rounded-lg text-xs text-accent">
            Imported {importDone.items} items, {importDone.themes} themes, {importDone.attachments} attachments.
          </div>
        )}
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

      {/* Import confirm modal */}
      {pendingImport && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
          <div className="bg-surface-1 border border-line-strong rounded-xl shadow-2xl p-5 max-w-md w-full">
            <h3 className="text-sm font-semibold text-ink mb-2">Replace local data?</h3>
            <p className="text-xs text-ink-3 mb-3">
              This will <strong className="text-ink-2">delete everything currently in Sidecar</strong> and
              load the backup. Settings keys are merged (not replaced).
            </p>
            <ImportSummaryList summary={summarize(pendingImport)} exportedAt={pendingImport.exportedAt} />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="px-3 py-1.5 text-xs border border-line hover:border-line-strong text-ink-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={importing}
                className="px-3 py-1.5 text-xs bg-red-500 hover:opacity-90 text-white rounded-lg transition-opacity disabled:opacity-50"
              >
                {importing ? 'Importing…' : 'Replace data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ImportSummaryList({ summary, exportedAt }: { summary: ImportSummary; exportedAt: string }) {
  const rows: Array<[string, number]> = [
    ['Items', summary.items],
    ['Themes', summary.themes],
    ['Attachments', summary.attachments],
    ['Suggestions', summary.suggestions],
    ['Rejections', summary.rejections],
    ['Edges', summary.edges],
  ]
  return (
    <div className="bg-surface-2 border border-line rounded-lg p-3 text-xs">
      <div className="text-[10px] text-ink-3 mb-2">
        Backup from {new Date(exportedAt).toLocaleString()}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
        {rows.map(([label, n]) => (
          <li key={label} className="flex justify-between text-ink-2">
            <span>{label}</span>
            <span className="tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

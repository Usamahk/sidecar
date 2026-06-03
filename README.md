# Sidecar

A Chrome extension that lives in your browser's side panel and acts as a persistent research workspace. As you browse newsletters, Reddit, Twitter, or any web page, you can capture quotes and content, annotate them with personal notes, track their source and date, and search across everything you've saved.

Built as a local-first tool — all data stays in your browser (IndexedDB), with export options for backup and portability.

The extension wears a warm-neutral identity: Instrument Serif for the wordmark and headings, Geist for the body, Geist Mono for the chrome (eyebrows, source tags, keyboard hints). The toolbar icon is a top-down motorcycle outline with a coral sidecar pod — the same mark sits in the panel header next to the wordmark. Day and night modes use the same coral accent over warm-neutral surfaces.

---

## What it does now

### Capture
- Paste text into the capture bar at the top of the panel to save it instantly
- The current tab's URL and today's date are auto-filled on every capture
- Drag-and-drop or paste images (screenshots) directly into the capture bar — they're stored as attachments on the item
- Add a screenshot to any existing item using the 📎 button on its card
- Press `⌘↵` (or `Ctrl↵`) to capture, `Esc` to clear

### Source tagging
- Every item is automatically tagged with its source type: **Newsletter**, **Website**, or **Internal**
  - Pages on `mail.google.com` are tagged Newsletter and attempt to extract the sender name from the open email
  - All other pages are tagged Website
  - Internal is for personal notes, company events, or anything you want to add manually
- Click the source tag on any item to change it via a dropdown, and edit the sender/label field alongside it

### Timeline
- All captured items appear in reverse-chronological order by default
- Toggle to oldest-first with the sort button at the top of the timeline
- Search across all item content, notes, URLs, and page titles using the search bar (fuzzy search powered by Fuse.js)
- Filter by theme via the chip strip above the list — single-select, intersects with search
- Result count shown when a search or filter is active; clear it to return to the full timeline

### Themes & organization
- Create named, color-coded theme buckets from the Themes tab — 10-color palette, recolorable any time
- Inline rename, color-swatch picker, and delete (cascades — also drops from all tagged items)
- Click the **+ theme** chip on any item to assign an existing theme, or type a new name + `Enter` to create + assign in one step
- Expand any theme on the Themes tab (click its item count) to see all items tagged with it as full cards, newest first
- Each item card shows its assigned theme chips; click the `×` on a chip to unassign

### AI auto-categorize
- One-click **Scan** from the Themes tab sends your corpus to Claude (default: Sonnet 4.6; optional: Haiku 4.5)
- **Scope toggle** below the button — `Untagged (N)` (items with no themes assigned, the default once any exist) or `All (N)` (everything, useful when you want fresh proposals from already-tagged content)
- Cost-confirm popover before sending shows the item count and a rough input-token estimate
- Returns two things in one structured call (Anthropic tool-use): **tag suggestions** to existing themes (with confidence) and **proposals** for new themes (with supporting items)
- Inline **review queue** on the Themes tab — nothing auto-applies:
  - Proposals: editable name + recolorable swatch before approve; approve creates the theme and tags its supporting items in one go
  - Tag suggestions: grouped by theme with per-row ✓/✗ and bulk ✓ all / ✗ all per group
- **Rejection memory** — rejected proposals and assignments are remembered and excluded from the next scan; self-heals if you later manually create/assign the same thing

### Per-item editing
- **URL** — click to edit inline; domain and favicon shown in display mode
- **Date** — click to edit with a date picker; timeline re-sorts automatically when a date is changed
- **Notes** — free-text textarea below each item's content; saves on blur
- **Markdown rendering** — captured content is rendered as formatted markdown (GFM supported)
- **Delete** — remove an item and all its attachments with the ✕ button

### Appearance
- Dark mode, light mode, and system (follows OS setting) — toggled from Settings
- Preference is persisted across sessions

### Backup & restore
- **Connect a backup folder** (File System Access API) — point Sidecar at any folder on disk and it auto-writes a `sidecar-snapshot.json` there on every change (debounced ~2s)
- Point the folder at iCloud Drive / Dropbox / Google Drive and you get free cross-device sync and version history from a service you already trust
- **Restore from folder** loads the snapshot back, replacing local data
- **Import JSON** picks a backup file directly (e.g. one of those auto-snapshots, or any prior export) — shows a summary modal of what's inside before replacing data
- **Export JSON** is a full backup including attachments, settings, suggestions, and rejections (formatVersion 2 — base64-encoded blobs round-trip through import)
- **Export Markdown** — one entry per item, Obsidian-compatible YAML frontmatter
- Storage status line shows whether the browser has marked IndexedDB as persistent (requested automatically on first launch)

### AI research agent
- A Claude-powered chat interface in the **Agent** tab that answers questions grounded in your captured corpus
- **Corpus retrieval** — every prompt runs a ranked Fuse.js search over your items (content, notes, URLs, titles, sender), boosted by theme match, notes match, and recency, and the top hits are fed to the model as context
- **Web augmentation** (optional toggle) — pulls Wikipedia search results + summaries into the context alongside your own items
- **Inline citations** — answers cite sources as `[S#]` (Sidecar item) or `[W#]` (web), and only the sources the model actually used are surfaced under each reply
- **Conversations** persist in IndexedDB — multiple threads, auto-titled from the first prompt, with recent history carried into follow-ups
- Uses prompt caching on every request and adaptive thinking where the model supports it (Opus 4.7 / Sonnet 4.6 — not Haiku); runs against your local Anthropic API key

**Retrieval design note.** Retrieval is currently a single ranked Fuse.js pass over the corpus, with score boosts for theme match, notes match, and recency. **Revisit when** typical corpora exceed ~2000 items or paraphrastic queries start missing items the user knows are there — at that point consider HyDE (a Haiku-written hypothetical-answer expansion fused with the original query) or a true embeddings provider (Voyage, local MiniLM via `transformers.js`, or whatever Anthropic ships), which can slot in beneath the existing context-assembly pipeline.

### Settings
- Store your Anthropic API key locally (used by the scan and the agent)
- Pick the scan model — Sonnet 4.6 (default) or Haiku 4.5 (cheaper, rougher proposals)
- Pick the agent model — Opus 4.7 (default), Sonnet 4.6, or Haiku 4.5
- Agent defaults — web augmentation on/off, response mode (detailed/concise), and how many corpus items to pull into context (1–12)
- Clear all data from the danger zone

---

## Coming soon

### Visual knowledge graph (Phase 4)
An interactive node-link diagram of your entire research corpus. Items, themes, and AI-extracted concepts appear as nodes; relationships between them as edges. Click any node to open the item or filter the timeline. Node size reflects connection count.

---

## Tech stack

| Concern | Choice |
|---|---|
| Extension | Chrome Manifest V3 + Side Panel API |
| Build | Vite + `@crxjs/vite-plugin` + TypeScript |
| UI | React 18 + Tailwind CSS, Geist + Instrument Serif + Geist Mono via Google Fonts, line-icon set in `components/Icons.tsx` |
| Storage | Dexie.js (IndexedDB) |
| Search | Fuse.js |
| Markdown | react-markdown + remark-gfm |
| AI | Anthropic SDK (claude-opus-4-7 / claude-sonnet-4-6 / claude-haiku-4-5), tool-use for structured output, adaptive thinking + prompt caching for the agent, lazy-loaded |
| Backup | File System Access API (auto-snapshot to user-chosen folder) + persisted IndexedDB |
| Graph (upcoming) | react-force-graph-2d |
| Export | file-saver |

---

## Development

**Prerequisites:** Node.js, Chrome

```bash
npm install
npm run dev        # starts Vite dev server with hot reload
npm run build      # produces a production build in dist/
```

**Load the extension in Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder
4. Click the Sidecar icon in the toolbar to open the side panel

After reloading the extension, refresh any open tabs to reinitialise the content scripts.

---

## Data & privacy

Everything is stored locally in your browser's IndexedDB. Nothing is sent anywhere unless you enter an Anthropic API key and either run **Scan** (which sends item snippets + notes to the Anthropic API for categorization) or chat with the **Agent** (which sends your prompt plus the retrieved item snippets, and — if web augmentation is on — fetches from Wikipedia). A cost-confirm popover shows the item count and rough token estimate before each scan. The API key itself never leaves your browser.

**Durability.** IndexedDB can be wiped if you clear site data in Chrome. Two protections:
- Sidecar requests **persistent storage** on first launch (survives passive eviction under disk pressure).
- For real durability, **connect a backup folder** — snapshots write to disk on every change. Point at a synced folder (iCloud, Dropbox, Drive) and your data is replicated wherever that service syncs to. The folder handle is the only thing stored on this machine; the files themselves are yours.

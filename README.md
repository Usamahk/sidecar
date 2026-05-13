# Sidecar

A Chrome extension that lives in your browser's side panel and acts as a persistent research workspace. As you browse newsletters, Reddit, Twitter, or any web page, you can capture quotes and content, annotate them with personal notes, track their source and date, and search across everything you've saved.

Built as a local-first tool — all data stays in your browser (IndexedDB), with export options for backup and portability.

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
- Result count shown when a search is active; clear the search to return to the full timeline

### Per-item editing
- **URL** — click to edit inline; domain and favicon shown in display mode
- **Date** — click to edit with a date picker; timeline re-sorts automatically when a date is changed
- **Notes** — free-text textarea below each item's content; saves on blur
- **Markdown rendering** — captured content is rendered as formatted markdown (GFM supported)
- **Delete** — remove an item and all its attachments with the ✕ button

### Appearance
- Dark mode, light mode, and system (follows OS setting) — toggled from Settings
- Preference is persisted across sessions

### Settings & export
- Store your Anthropic API key locally (used by the AI agent when it ships)
- Export all data as **JSON** (full backup of items, themes, edges, and concepts)
- Export as **Markdown** (one entry per item, Obsidian-compatible YAML frontmatter)
- Clear all data from the danger zone

---

## Coming soon

### Themes & organization (Phase 2)
Create named, color-coded theme buckets and assign items to them. Filter the timeline by theme. Theme chips on each item card for quick visual scanning.

### AI research agent (Phase 3)
A Claude-powered chat interface (claude-opus-4-7) built into the Agent tab. The agent can search across your captured items and the web simultaneously, and has full context of your research corpus when answering. Auto-tagging on capture will suggest themes and extract key concepts.

### Visual knowledge graph (Phase 4)
An interactive node-link diagram of your entire research corpus. Items, themes, and AI-extracted concepts appear as nodes; relationships between them as edges. Click any node to open the item or filter the timeline. Node size reflects connection count.

---

## Tech stack

| Concern | Choice |
|---|---|
| Extension | Chrome Manifest V3 + Side Panel API |
| Build | Vite + `@crxjs/vite-plugin` + TypeScript |
| UI | React 18 + Tailwind CSS |
| Storage | Dexie.js (IndexedDB) |
| Search | Fuse.js |
| Markdown | react-markdown + remark-gfm |
| Graph (upcoming) | react-force-graph-2d |
| AI (upcoming) | Anthropic SDK (claude-opus-4-7) |
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

Everything is stored locally in your browser's IndexedDB. Nothing is sent anywhere unless you enter an Anthropic API key and use the AI agent (at which point only your query and a summary of relevant items are sent to the Anthropic API). The API key itself never leaves your browser.

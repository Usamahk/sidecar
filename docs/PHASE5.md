# Phase 5 — Research Builder + OKF Compounding Wiki

**Status:** Planned (not yet implemented) · **Drafted:** 2026-05-21 · **Supersedes:** the RAG chat agent

This document is the agreed design for Sidecar's next phase. It was reached by
stress-testing the current agent against two source ideas: the **LLM Wiki**
pattern (incrementally-maintained markdown knowledge base) and Google's
**Open Knowledge Format (OKF)** spec (a minimal, specified markdown+frontmatter
format for agent-readable knowledge). The plan is plan-only; no code has been
changed.

---

## North star

> **Sidecar owns: capture → resolve → research → dossier → compounding wiki.
> Output is a thin, pluggable layer that can run anywhere.**

The research-and-compounding layer is the moat and lives inside Sidecar. Output
generation (newsletter, blog, tweet/thread, research study, slide deck) is
deliberately *not* privileged: the **dossier is a portable OKF artifact**, so
you can finish a piece in Sidecar, in Claude, in Obsidian, or in Marp.

- **IndexedDB** stays the typed source-of-truth for structure *and* the
  freshness engine.
- The **OKF vault** (markdown + YAML frontmatter, written into the connected
  backup folder) is the durable, portable, agent-traversable *projection* of
  that structure plus the generated prose. It can be an Obsidian vault.
- The extension **owns and writes** the vault; Obsidian is a read/browse window.

### Why this, and not the current agent

The current agent (`chat.ts` + `retrieval.ts` + `web.ts` + `AgentView`) is pure
RAG: every turn runs a fresh Fuse search and discards the result. Nothing
compounds. That is precisely the failure mode the LLM-wiki doc critiques —
"rediscovering knowledge from scratch on every question." Sidecar already has
the *structured* layer (themes, insights, typed edges) but no *synthesis* layer
and no compounding artifact. Phase 5 adds both, and rebuilds the agent as a
**document-builder** rather than a chat box.

---

## Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Synthesis layer = **file-based OKF vault** in the connected backup folder | Reuses the LLM-wiki/Obsidian model; the FSA folder primitive already exists; free graph view / backlinks / Marp / version history |
| 2 | **Extension owns/writes** the vault; Obsidian is read-only | No two-way-sync conflict machinery; matches "most interaction in the extension" |
| 3 | Source acquisition = **source-aware lazy resolver at build time**, snippet-as-intent-anchor | Capture stays light (URL + snippet); the snippet signals *what the user cared about*; resolution happens where the depth is needed |
| 4 | v1 = the **insight → dossier → output spine**; compounding wiki is a designed fast-follow | Prove the end-to-end value before the harder compounding/maintenance layer |
| 5 | Adopt **OKF** as the vault's on-disk format | Spec'd version of the format we'd build anyway; self-describing, portable, gives `index.md`/`log.md`/progressive-disclosure for free |
| 6 | **Builder-only in v1; retire the chat stack.** Q&A returns later as wiki-grounded query | Chat felt bad because it had nothing accumulated to read; rebuild it over the vault once the substrate exists |
| 7 | Builder orchestration = **hybrid** (code skeleton + bounded agentic research stage) | Predictable cost/progress envelope + adaptive "dive deeper" where it matters |
| 8 | Builder runs **foreground, checkpointed/resumable** | Robust against panel-close mid-build without MV3 background-worker complexity; checkpoints are the first half of a future background move |
| 9 | Output is a **separate step** from the dossier | One dossier → many outputs; re-render voice/format without re-researching; the dossier is the compounding asset |
| 10 | v1 output = dossier + frictionless **handoff** + **one** in-app template (newsletter) | Exercises the template-registry + output-model-role plumbing once; everything else is a template add |
| 11 | Compounding update model = **lazy staleness + incremental integration** | The only model that actually *compounds* (accumulates + integrates) while staying cheap; uses the edge graph as the propagation engine |
| 12 | OKF vault lives in the **existing connected folder** alongside `sidecar-snapshot.json` | One "Sidecar data folder" = JSON restore + readable OKF bundle; near-zero new plumbing |

### Output layer specifics (from #9/#10)
- **Formats are an open registry** — each format (newsletter, blog, tweet/thread,
  research study, Marp slides, …) is a **template = data, not code**. OKF `type`
  carries the format. Adding a format = adding a template.
- **The output model is a swappable role, including `manual` (pure handoff).**
  `resolve`/`research`/`synthesize` roles stay Anthropic; the `output` role is
  the pluggable/any-provider/optional one. This is the real justification for the
  per-role model binding (deferred until a second role actually needed it).
- **Handoff is first-class** — the dossier is an OKF file, so "open file" +
  "copy to clipboard" is the whole integration.

### Compounding wiki specifics (from #11)
- **Freshness engine = the typed edge graph.** On item add/tag/edit, walk edges
  to find affected theme pages + insight dossiers and mark them **stale** (via an
  evidence-hash of item ids + their `updatedAt`). No LLM calls on capture.
- **Incremental integration on refresh** — feed the model *the existing page +
  the delta (new/changed items) + "integrate these, flag contradictions,"*
  preserving accumulated synthesis. Pulled (lazy), not pushed (eager).
- **Lint = a review-queue health check** — flags contradictions, stale pages,
  orphan sources, missing theme pages, gaps; reuses the existing review-queue +
  rejection-memory pattern.
- `index.md` / `log.md` auto-maintained on each build/integration/lint.

---

## Data-model changes

**Add**
- `builds` — per-insight build state for checkpoint/resume:
  `{ insightId, status, step, resolvedItemIds[], startedAt, updatedAt, costTokens }`.
- `vaultDocs` — IndexedDB index of OKF concepts in the vault (freshness engine's
  home): `{ conceptId, type, evidenceHash, stale, builtAt }`. Lets the UI show
  stale state reactively without reading files.
- Settings — `vaultEnabled`, `voiceProfile` (style/audience/length),
  `outputTemplates` (user additions; built-ins shipped as data), per-role model
  bindings.
- `models.ts` — `{ id, label, inputPrice, outputPrice }` per model + a
  `ModelRole` map (`resolve`/`research`/`synthesize` → Anthropic;
  `output` → pluggable incl. `manual`).

**Remove / migrate**
- Drop `conversations`, `messages`; delete `chat.ts`, `retrieval.ts`, `web.ts`,
  `AgentView`.
- Drop the vestigial `concepts` table.
- Migrate the API key from `db.settings` → `chrome.storage.local` (`.local`, not
  `.sync`), then delete the settings row. (`storage` permission already present.)

---

## Modules

1. **`vault/`** — OKF read/write: frontmatter parse/serialize, bundle-relative
   links, `index.md`/`log.md` upkeep, paths via the existing `backup.ts` folder
   handle.
2. **`ai/resolve/`** — source-aware lazy resolver with fallback chain
   (cache → fetch+Readability / reddit `.json` / web_search), writes
   `sources/*.md`, snippet-as-anchor. Per source type:
   - Newsletter → snippet is the seed; deepen via web_search + follow links in
     the snippet (never grab the email DOM).
   - Website article → fetch URL + Readability → fallback web_search.
   - Reddit → fetch URL with `.json` appended.
   - Twitter/X → web_search (plain fetch returns a login shell).
3. **`ai/builder/`** — hybrid orchestration: gather (DB) → resolve (parallel,
   checkpointed) → bounded agentic research (capped web_search + link-follow) →
   synthesize `insights/<slug>.md`. Writes checkpoints to `builds`.
4. **`ai/output/`** — template registry (data-driven) + output-model role (incl.
   `manual`) → `outputs/*.md` + handoff (copy / open file).
5. **`db/freshness.ts`** — edge-graph staleness propagation, evidence-hash,
   `vaultDocs` upkeep.
6. **`ai/wiki/`** — theme-page incremental integration + lint review-queue op
   (compounding fast-follow).
7. **UI** — the freed "Agent" tab becomes **Research**: insight → Build action,
   progress view, dossier render (read from vault), output panel; later: wiki
   browse + stale badges + lint queue.

---

## Build order

### Phase A — Foundations (unblock everything; mostly invisible)
1. Retire the chat stack + drop `conversations`/`messages`/`concepts` (migration).
2. `models.ts` + per-role bindings; passive cost-display helper.
3. API key → `chrome.storage.local` + migration.
4. `vault/` OKF layer (reusing the backup folder handle); generalize the
   write-split (snapshot JSON on corpus change, OKF files on build).

### Phase B — The spine (v1 goal)
5. Source resolver + `sources/*.md` + source cache + `builds` checkpoint table.
6. Builder (hybrid) → `insights/<slug>.md` dossier; checkpoint/resume; cost
   ceiling + display.
7. Builder trigger UI on an insight + progress view + dossier render (replaces
   the old insight → chat prefill).
8. Output: template registry + **newsletter** template + output-model role (incl.
   `manual`) + `outputs/*.md` + handoff.

→ **v1 done:** select insight → research deep → dossier in vault → newsletter
draft *or* hand off.

### Phase C — Compounding wiki
9. Freshness engine: `vaultDocs` + evidence-hash + edge-graph propagation on item
   change; stale badges.
10. `themes/` pages via incremental integration (existing page + delta) on-demand
    + batch "update wiki"; `index.md`/`log.md` upkeep.
11. Lint: review-queue health check (contradictions, stale, orphans, missing
    theme pages, gaps).

### Phase D — Wiki-grounded Q&A (the reborn chat)
12. Query reads `index.md` → drills into concepts → answers with citations →
    files good answers back as OKF concepts.

---

## OKF mapping reference

| Sidecar page | Path | OKF `type` | Key frontmatter |
|---|---|---|---|
| Source page | `sources/<slug>.md` | `Article` / `Newsletter` / `Tweet` / `Reddit Post` | `resource: <url>`, `tags: [themes]`, `timestamp` |
| Insight dossier | `insights/<slug>.md` | `Insight` | `title: headline`, `description: rationale` |
| Theme page | `themes/<slug>.md` | `Theme` | `title`, `description` |
| Output draft | `outputs/<slug>.md` | `Newsletter Draft` / `Blog Draft` / `Slide Deck` / … | `title`, `tags` |
| Catalog | `index.md` | — (no frontmatter except optional `okf_version`) | progressive disclosure |
| History | `log.md` | — | ISO-dated, newest first |

- Filenames use a stable `slug+id` so renamed headlines don't orphan files.
- Links are bundle-relative (`/themes/plg.md`); broken links are tolerated
  (not-yet-written knowledge), per OKF §5.3 / §9.
- IndexedDB holds the *typed* edges; the vault renders them as *untyped* markdown
  links. The DB + JSON snapshot remains authoritative; the vault is a projection.

---

## Sharp edges to watch

- **MV3 + long builds** — foreground checkpoint/resume mitigates; background is a
  later upgrade (the checkpoint design is its first half).
- **Resolver fragility** (Twitter, paywalls, JS-SPAs) — web_search fallback; the
  pasted snippet is always the floor.
- **Integration drift** (Phase C) — evidence-hash prevents silent staleness; lint
  catches drift and page bloat.
- **Cost** — the builder is the expensive surface; per-build ceiling + display,
  hard caps on the research loop.
- **Vault ≠ rebuildable source of truth** — the JSON snapshot remains the restore
  path; the vault is a projection (accepted under decisions #1/#2).
- **OKF v0.1 is a draft** — conformance surface is tiny and consumption is
  permissive, so version churn is low-risk.

---

## Carried over from the chat-agent grill

These infrastructure decisions predate the pivot but still apply to the builder:
`models.ts` + per-model pricing; passive per-turn/﻿per-build cost display; API key
→ `chrome.storage.local` with migration; the generalized write-split. The
chat-specific designs (threading, retrieval frame, inline-citation streaming) are
dropped along with the chat stack.

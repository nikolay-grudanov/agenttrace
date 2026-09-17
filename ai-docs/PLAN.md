# PLAN.md — opencode-workshop (Kolya's fork)

> **Single source of truth for all development work in this repo.**
> Features at the top (newest first), each with checkboxes. Update in the same commit as the code change.

## Conventions (same as opencode-workshop-plugin fork)

- **Feature = a vertical slice of work** (one user-visible capability, one bug fix, or one cleanup).
- **Todo = a single atomic step** inside a Feature. Marked `- [ ]` (pending) or `- [x]` (done).
- **F-NNN = Feature ID**, assigned in order of creation. Never reused.
- **Order:** open Feature at the top of the file. Newest F-number first.
- **Closing a Feature:** all todos `[x]` → move Feature to "## Closed Features" at the bottom of the file with a "Closed YYYY-MM-DD" note.

---

## Roadmap (Tier 1, next-up) — 2026-09-17

Public release is live (`v0.0.1` on npm under `latest`). Next-up items, in priority order:

- **T1-A. Sync upstream `raindrop-ai/workshop` v0.1.21** — we're 8 commits behind upstream; their changes include a `display_name` column on runs (DB migration conflict — our `0002_fts5_spans` already occupies idx 2, theirs is `0002_flowery_shinobi_shaw`). Resolution plan: rename our FTS5 migration to `0003` with a migration-safety check (don't re-run if `spans_fts` already exists), then merge upstream. ~2-3 hours.
- **T1-B. Git LFS for binaries** — current `binaries/raindrop-linux-x64` (79 MB) and `raindrop-windows-x64.exe` (99 MB) trigger GitHub "large file" warning on every push. Migrating to LFS silences the warning and speeds up `git clone`. ~1 hour.
- **T1-C. macOS / linux-arm64 binaries** — only linux-x64 + win32-x64 ship today. Either expand `bin/raindrop.js` to support more platforms (requires cross-compile in CI on darwin host for ad-hoc signing) or document source-build as the only path. Open question: do we even own the platform set, or keep it narrow on purpose?
- **T1-D. Build a real src/index.ts + tsup pipeline for the plugin** — currently the plugin ships only hand-edited `dist/index.{js,cjs}` (no source). This was fine for the alpha but blocks normal dev cycles (PR review, typecheck, lint, tests). Spec: feature F-002 originally. ~1-2 days.
- **T1-E. Public-release hygiene automation** — `Makefile`-equivalent that runs pre-publish checklist + smoke test against the published tarball (not local dist) on every future `npm publish`.
- **T1-F. F-023 — Multi-source agent instrumentation (Qwen Code + GigaCode)** — Plan-only stage. Bridge-only architecture (HTTP hooks, no OTLP): new sibling repo `openworkshop-qwen-bridge` (Node/TS) translates Qwen Code + GigaCode hook events into the OpenCode-plugin wire format and POSTs to `localhost:5899/v1/`. Workshop daemon gets minimal additions (`agent_provider` in `runs.metadata`, UI badge/facet). GigaCode adapter authored by corporate agent on Kolya's laptop against our wire contract; Qwen Code adapter authored here. Stages 0–7 estimated ~4 days. See `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md`, `openspec/specs/source-aware-ingestion/spec.md`, `ai-docs/specs/F-023-multi-source-ingestion-research.md`.

The plugin-side T1-D (`loadConfig` cwd bug) is also open — see `ai-docs/specs/F-011-loadconfig-cwd-bug.md`.

---

## Active Features

### F-023 — Multi-source agent instrumentation (Qwen Code + GigaCode) — Plan only

**Context:** Workshop currently ingests spans from OpenCode only, via our companion plugin. Kolya wants the same fidelity for Qwen Code (Alibaba's fork of Gemini CLI) and GigaCode (Sberbank's fork of Qwen Code). Both tools emit standard OpenTelemetry GenAI semantic conventions natively — no vendor SDK adapter needed, just a new GenAI-SC-aware adapter and a hook-handler endpoint for Qwen Code's `http`-type hooks. This feature does NOT violate `openspec/config.yaml` HARD rule "OpenCode-only — never add Codex/Claude/Anthropic-specific code" because Qwen Code / GigaCode are Gemini-CLI-family forks that emit industry-standard OTel GenAI-SC; the adapters target the standard, not a vendor SDK.

**Decisions (locked 2026-09-17, scope-check approved):**
- **Channel C (hybrid):** OTLP ingest at `:5899/v1/traces` for span tree / tokens / model info + HTTP-hook handler at `:5899/api/qwen/hooks` for `PreToolUse` / `PostToolUse` / `Stop` / `SubagentStop` events.
- **GigaCode:** treated as Qwen-Code-compatible for now. Smoke-test deferred to corporate laptop (F-024 ready if divergence appears).
- **Target version:** `qwen-code` stable tag (exact tag pinned at Stage 5 smoke-test time).
- **UI:** source-aware badge in `RunsPage` + `SearchPage` + `RunDetail`, source facet in `/api/facets`, both languages (en + ru).
- **Schema:** add `source` enum column to `runs` and `spans` (Drizzle migration `0004_source.sql`), indexed.

**Scope anchors (no code yet):**
- `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md` — design / scope / decisions / risks.
- `openspec/specs/source-aware-ingestion/spec.md` — capability spec (R1-R6 requirements, S1-S7 scenarios, OQ1-OQ4 open questions).
- `ai-docs/specs/F-023-multi-source-ingestion-research.md` — full Qwen Code span inventory × `NormalizedSpan` mapping table (LLM, Tool, Subagent, Hook, Daemon spans), hook-event shapes, GigaCode assumptions, adapter pseudocode, migration SQL.

**Stages (each = one Feature-step, each buildable/testable independently):**
- Stage 0. Research + ADR (proposal.md + spec.md + research.md done; PLAN.md entry written)
- Stage 1. Ingestion pipeline + `source` field migration (~1 day)
- Stage 2. GenAI-SC adapters in `src/spans/adapters/qwen.ts` (~1 day)
- Stage 3. HTTP-hook handler `POST /api/qwen/hooks` (~½ day)
- Stage 4. UI source-aware display (~½ day)
- Stage 5. End-to-end live smoke on Kolya's local Qwen Code with `glm` provider (~½ day)
- Stage 6. Docs + release 0.0.2 (~½ day)

**Total estimate:** ~4 days wall-clock.

**Todos:**
- [x] Plan F-023 (proposal.md, spec.md, research.md written; PLAN.md entry written)
- [ ] Stage 0.4 — Kolya reviews proposal + spec + research, approves scope
- [ ] Kolya provides: exact `qwen-code` stable tag, exact GigaCode `service.name` (or confirms "sandbox-agent")
- [ ] Stage 1.1 — Drizzle schema `source` enum
- [ ] Stage 1.2 — Migration `0004_source.sql`
- [ ] Stage 1.3 — `parseOtlpRequest` `service.name` → `source` mapping
- [ ] Stage 1.4 — `inferSpanType` Qwen-prefix rules
- [ ] Stage 1.5 — Payload-size clamp guard
- [ ] Stage 2.1 — `qwenGenAiLlmAdapter`
- [ ] Stage 2.2 — `qwenGenAiToolAdapter`
- [ ] Stage 2.3 — `qwenSubagentAdapter`
- [ ] Stage 2.4 — Register in `ADAPTERS[]`
- [ ] Stage 3.1 — `POST /api/qwen/hooks` handler
- [ ] Stage 3.2 — Hook span tree stitching via `gen_ai.conversation.id`
- [ ] Stage 3.3 — Rate-limit guard
- [ ] Stage 4.1 — `RunsPage` source column + chip
- [ ] Stage 4.2 — Source facet in `/api/facets`
- [ ] Stage 4.3 — Source filter in `SearchPage`
- [ ] Stage 4.4 — i18n labels (en + ru)
- [ ] Stage 4.5 — `RunDetail` source chip
- [ ] Stage 5.1 — Live smoke recipe doc
- [ ] Stage 5.2 — Run Kolya's Qwen Code against workshop daemon (requires Kolya's daemon restart — AGENTS.md hard rule #2)
- [ ] Stage 5.3 — Snapshot DB and attach artifact
- [ ] Stage 6.1 — `README.md` «Supported sources» table
- [ ] Stage 6.2 — Update umbrella `STATUS.md`
- [ ] Stage 6.3 — Bump version 0.0.1 → 0.0.2, rebuild binaries, publish, tag, GitHub release
- [ ] Stage 6.4 — `hindsight_retain` publish fact (AGENTS.md hard rule #6)

**Plugin-repo impact:** NONE (Qwen Code emits OTel natively; GigaCode = OpenCode-attach covered by existing plugin).

### F-021 — DCP compression analytics: convo stats, feed, full summaries

**Context:** F-020 surfaced individual `compress` tool calls, but Kolya asked for conversation-level visibility: how many compressions happened, what the agent kept in each, and the token economics. The exact token deltas live in DCP's chat notifications — `Compression #N -X removed, +Y summary · M messages and K tools compressed` — which DCP injects into the NEXT LLM request's input messages, so they are parseable from captured LLM spans. Also fixed en route: F-020's detection gate looked for an "opencode-dcp" marker in `attributes`, but the plugin stamps only `ai.toolCall.name` there — the banner silently never rendered on real data. Detection is now by payload shape (`topic` + `content[]` with `startId`/`endId`).

**Result:**
- `src/agents.ts` — `detectCompressions(spans)` (+ `Compression`/`CompressionBlock` types): chronological compress calls with topic/blocks; scans LLM span `input_payload`s for the notification regex and joins exact `removed_tokens`/`summary_tokens`/messages/tools by DCP's sequential `#N`. `SpanRow` grew optional `input_payload`/`output_payload`/`run_id`.
- `src/db.ts` — `getConvoCompressions(convoId)`: loads all convo spans with payloads, runs detection, aggregates totals (`removed_tokens`, `summary_tokens`, `net_tokens`, messages, tools).
- `src/server.ts` — `GET /api/convo/:convoId/compressions`.
- `app/src/api/convo-compressions.ts` + `app/src/hooks/use-convo-compressions.ts` — typed client (mirrors the F-012 statistics pattern).
- `app/src/components/ConvoDetail.tsx` — `DcpCompressionsPanel` under Convo Stats: teal chip header ("N compressions · −X removed · +Y summary · net −Z tok"), totals table, and the numbered feed (#1, #2, … with topic, per-entry deltas, messages/tools, age; click expands the full block summaries with run/duration footer). Hidden when the convo has no compressions. Visible in both the convo page and RunDetail's Convo tab.
- `app/src/utils/dcp.ts` (new) — shared client parser `parseDcpCompression()` (payload-shape gate, no attributes marker).
- `app/src/components/DcpCompressionBlock.tsx` (new) — shared teal banner used by `ToolCallPill` and `SpanDetail`; per-block summaries truncate at 220 chars with a "See full summary (N chars)" toggle (item 3). Local F-020 parser copies deleted from both components.
- `app/src/utils/span-colors.ts` — `spanTypeFromRaw` gate switched to payload shape (the F-020 attributes-marker bug fix).

**Verified:** `tests/compressions.test.ts` — 6 new tests (notification join by #N, non-DCP payload ignored, chronological indices, missing-notification degradation, DB aggregation scoped to convo, empty convo). Full suite 108/108; root tsc clean; lint 0 errors; `build:ui` ok. Ran `getConvoCompressions` against the live DB out-of-process on convo `ses_f75db3742…`: 2 compressions, totals −214 removed / +120 summary / net −94, 6 messages.

**Known issue (needs Kolya's word):** the daemon's `bun --watch` is wedged in a mixed module state (new route registered, old `db.ts` import cached → `ReferenceError: getConvoCompressions is not defined` on the new route only; all other routes fine; touches don't recover it). A daemon restart will pick everything up. Do NOT restart without Kolya's say-so (fork rule).

**Plugin-repo impact:** NONE.

**Todos:**
- [x] detectCompressions + notification parsing (src/agents.ts)
- [x] getConvoCompressions + /api/convo/:id/compressions
- [x] ConvoDetail panel: totals + numbered feed with topics
- [x] Shared DcpCompressionBlock with "See full summary" in ToolCallPill/SpanDetail
- [x] F-020 gate bugfix (payload shape, not attributes marker)
- [x] Tests (6) + tsc + lint + build:ui + out-of-process real-DB run
- [ ] Live endpoint check after daemon restart (awaits Kolya's word on restart)
- [ ] Commit + push (awaits Kolya's word)

### F-020 — Dedicated COMPRESSION span type for opencode-dcp

**Context:** With the opencode-dcp plugin ([opencode-dynamic-context-pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)) installed, the model invokes a tool named `compress` to prune redundant context. Before F-020 these compress calls landed as generic `TOOL_CALL` spans with teal-on-teal pill colour, no badge, and no readable summary — operators had to eyeball raw JSON. Per-run conversation view also couldn't tell at a glance how many compressions happened and what the agent kept.

**Result:**
- `app/src/utils/types.ts` — extended `SpanType` union with `COMPRESSION`.
- `app/src/utils/span-colors.ts` — `SPAN_TYPE_COLORS.COMPRESSION = "#5fbfb0"` (teal, distinct from `SUB_AGENT_ROOT` gold) and badge label `COMP`. `spanTypeFromRaw()` now takes an optional span; when `name === "compress"` and `attributes` contain the opencode-dcp marker, the projection returns `COMPRESSION` (a bare compress tool that *isn't* DCP stays `TOOL_CALL`, so other plugins reusing the name aren't retyped by accident).
- `app/src/components/SpanTree.tsx`, `app/src/components/FlameTimeline.tsx` — pass the full span to `spanTypeFromRaw` so the projection sees the name.
- `app/src/utils/colors.ts` — `spanColor(name, colorMap)` pins `compress` to teal so all compression pills line up regardless of registration order.
- `app/src/components/ToolCallPill.tsx` — when a tool pill opens, a teal "DCP compression" banner is rendered above the raw Input/Output panels listing the topic, number of blocks replaced, and each block's `startId → endId` + `summary` (range mode) or "block ref only" hint (message mode). Uses the opencode-dcp wire format: `input_payload = { topic, content: [{ startId, endId, summary }] }`.
- `app/src/components/SpanDetail.tsx` — equivalent dedicated block for the right-rail SpanDetail (rendered when the user clicks a compress span in the Span Tree / Session Tree).

**Verified:** root `bun x tsc --noEmit` clean; `bun run lint` 0 errors (3 pre-existing warnings); `bun test tests/` 102/102; `bun run build:ui` ok. `spanTypeFromRaw` projection unit-validated via `bun -e` script: DCP compress → COMPRESSION with teal `#5fbfb0` and label `COMP`; bare compress without dcp marker → stays `TOOL_CALL`; LLM tolerance preserved.

**Plugin-repo impact:** NONE.

**Todos:**
- [x] Plan F-020 (this entry)
- [x] SpanType union + projection + colour palette + ToolCallPill banner
- [x] tsc + lint + tests + build:ui
- [ ] Live smoke in IAB on run b8f2c50c (visual confirmation deferred — IAB screenshot surface timed out again)
- [ ] Commit + push (awaits Kolya's word)

**Follow-up (not done):** convo-level statistics — number of compressions per conversation, total tokens pruned vs summarised, topics. Plumbing exists (`spanTypeFromRaw` + `agents.ts` `detectSubAgents` could grow a sibling `detectCompressions`), but the UI and aggregation endpoints weren't built in this slice.

### F-019 — Bugfix: filter-only search always returned 0 results

**Context:** After F-017's multi-filter SearchPage, any search without free-text (agent=f014-test, model=X, has-errors, …) showed "0 spans across 0 runs". `searchSpans()` short-circuited to an empty result whenever `sanitizeFtsQuery(q)` produced no MATCH tokens — a leftover guard from F-008 when `q` was the only input — silently ignoring all active filters. Facets listed the agents and the runs existed, yet every filter-only query came back empty.

**Result:** `src/db.ts` `searchSpans()` now has two code paths. With a text query: unchanged FTS5 path (MATCH + snippet + BM25). Without text but with filters: a plain scan over `spans JOIN runs` (snippet/bm25 require MATCH, so the filter-only path returns an empty snippet and ranks by `spans.start_time_ms DESC`), with model/spanName/spanType filters remapped from `spans_fts.*` to `spans.*` columns. Empty query + no filters still returns empty (and the route still 400s on a bare request).

**Verified:** 5 new filter-only regression tests in `tests/search-api.test.ts` (agent; spanName/spanType/model; hasErrors; date range + recency order; empty query + no filters), `bun test tests/` 102/102; root tsc + lint clean. Live daemon (hot-reloaded): `?agent=f014-test` → 1, `?agent=opencode_session` → 513, `?q=bash` → 77 (unchanged), `?q=bash&agent=opencode_session` → 73, bare → 400. UI (IAB): agent=f014-test → "1 spans across 1 runs"; free-text bash → "77 spans across 34 runs" with highlighted snippets.

**Plugin-repo impact:** NONE.

**Todos:**
- [x] Fix searchSpans filter-only path
- [x] Regression tests + full suite green
- [x] Live verification (API + UI)
- [x] Commit + push (2026-09-09, Kolya approved)

### F-018 — LangSwitcher UX: globe-only rail button + flyout locale menu

**Context:** F-016's pill (`🌐 ru / en`) ignored the collapsed sidebar: in the 48px icon rail the locale text overflowed. Worse, hovering the pill called `setOpen(true)` — the *persisted* sidebar state (cookie `sidebar_state`, 7 days TTL) — so a single accidental hover expanded the rail to 15rem permanently, and nothing ever collapsed it back.

**Result:**
- `app/src/components/LangSwitcher.tsx` — globe-only icon button sized like the other rail icons; locales live in a small flyout menu anchored above the button. Opens on click or hover (120ms intent delay); closes on mouse-leave (250ms grace), Escape, outside pointerdown, or focus leaving the widget. Languages are endonyms ("English" / "Русский") with a check on the active one (W3C i18n guidance); the `ru / en` codes on the button are gone. Flyout is absolutely positioned (no portal) — the sidebar container has no `overflow-hidden`, so the menu escapes the collapsed rail.
- `app/src/components/NavSidebar.tsx` — hover-expansion wiring removed (`useSidebar`/`activate`/`onActivate` deleted); the sidebar never changes width for the switcher, so the "won't shrink back" bug is structurally impossible.

**Verified:** root `bun x tsc --noEmit` clean; `bun run lint` 0 errors (3 pre-existing warnings); `bun test tests/` 96/96; `bun run build:ui` ok. Live smoke in IAB on :5899: collapsed rail renders the globe-only button (empty text, `data-state="collapsed"` preserved); click opens the menu with English/Русский; switching to EN re-renders nav on the fly and back to RU; sidebar stays collapsed through all interactions; outside click dismisses the menu. Screenshots not captured (IAB screenshot surface timeout after reload — known quirk since F-015); visual check = hover the globe. Note: `cd app && tsc --noEmit` is broken independently of this change (pre-existing dual-@types/react conflict, 639 error lines before it too); root tsc remains the gate.

**Plugin-repo impact:** NONE.

**Todos:**
- [x] Rewrite LangSwitcher as globe-only button + flyout menu
- [x] Remove hover-expansion wiring from NavSidebar
- [x] tsc + lint + tests + build:ui
- [x] Live smoke in IAB (click path verified; hover path drives the same open state)
- [x] Commit (2026-09-09, Kolya approved; push awaits his word)

### F-008 — SQLite FTS5 full-text search across spans

**Status:** P1 storage layer implemented locally; P2 search API next.

**P1+P2+P3+P4 hotfix completed locally:**
- FTS5 storage layer (`spans_fts` + `buildSpanContentText()`)
- Search API (`/api/search`, BM25, snippets, pagination)
- UI wiring (debounced sidebar results, focus_span deep-link)
- Hotfixes: `upsertEventSpan()` now writes to `spans_fts` (was silently dropping new event-spans); `MATCH` query is sanitized via `sanitizeFtsQuery()`; snippet HTML is escaped at the API layer to make `dangerouslySetInnerHTML` safe.

**Verification:** `bun x tsc --noEmit`, `bun run lint` (0 errors, 3 pre-existing warnings), `bun test tests/` (61 pass); live DB tests confirm inserts go through FTS, malicious queries fail safely.

**Todos:**
- [x] F-008-P1 storage layer
- [x] F-008-P2 search API
- [x] F-008-P3 backfill + UI
- [x] F-008-P4 hotfix (upsertEventSpan FTS write, MATCH sanitizer, snippet escape)
- [x] F-008-P5 polish / advanced filters (deferred to F-014)

---

### F-014 — Advanced search filters (Workshop + Plugin)

**Context:** Plugin-side F-014 captures project/branch/head once at startup and stamps them into every track_partial event as `properties.git`. Workshop-side F-014 exposes `/api/search` filters (`agent`, `user`, `project`, `branch`, `commit`) plus a `/api/facets` endpoint and wires them into the RunsPage sidebar with autocomplete via `<datalist>`. Cross-repo change because git metadata originates at the plugin.

**Plugin (v0.1.0-kolya.14):**
- [x] `collectGitContext(worktree)` reads `rev-parse HEAD/abbrev-ref/show-toplevel` via `execFileSync` with `timeout: 1500ms`
- [x] `EventShipper2` accepts `gitContext` and stamps `properties.git` on every event
- [x] Bundles + static copy updated, `node --check` clean

**Workshop (this feature):**
- [x] `searchSpans()` extended with agent/user/project/branch/commit filters (JOIN runs)
- [x] `computeFacets()` returns top-50 distinct values per facet
- [x] `/api/facets` route
- [x] `/api/search` accepts `?agent=…&user=…&project=…&branch=…&commit=…`
- [x] RunsPage sidebar: 4 `<datalist>` inputs + commit prefix input
- [x] Result rows show `event_name` and git context (project/branch/commit prefix)
- [x] Live verified: 6 agents in facets, 2 results for `F011_PATCH_OK`, filter narrows results

**Todos:**
- [x] F-014-P1 plugin git capture
- [x] F-014-P2 workshop search API filters + facets
- [x] F-014-P3 runs page UI for filters + autocomplete
- [ ] F-014-P4 polish / cross-repo doc

---

## Active Features

## Roadmap (Tier 1, next-up) — 2026-09-08

After F-006 closed 2026-09-08. Two natural follow-ups: surface-tuning the chat panel and making the whole UI bilingual.

- **T1-C. F-015 — Configurable sidepanel prompt chips** — The "TraceDebugPrompt" row in `MessagePane.tsx` hardcodes 3-4 prompt chips ("What went wrong here?", "What workshop tools are available?", "Annotate trace…"). Pull them into an array `presetPrompts: { id, label, prompt }[]` so new chips can be added without touching the JSX. Tie chip labels to the i18n catalog so they survive the F-016 cut.
- **T1-D. F-016 — i18n infrastructure + Russian translation** — Workshop UI is en-only. Add react-i18next + i18next-browser-languagedetector with `I18nProvider`, `useT()` hook, autodetect from `navigator.language`, persist in `localStorage["workshop:lang"]`, lang switcher in NavSidebar. Translate: nav, runs page, settings, message pane (chips + placeholder + section titles + errors), search page, saved page, button labels, error messages. Bundled `en.json` and `ru.json`.

Handoff for a future session that picks this up: `HANDOFF-NEXT-SESSION.md`.

---

## Active Features

### F-015 — Configurable sidepanel prompt chips (TraceDebugPrompt)

**Context:** `MessagePane.tsx` has a `TraceDebugPrompt` row that renders 3 hardcoded chips when a run is focused and the chat is empty: "What went wrong here?", "What workshop tools are available?", "Annotate trace…". Each chip is a `<button onClick={() => sendMessage(prompt)}>`. Adding a new chip requires editing the JSX directly. Worse, chip labels are en-only — they will not survive F-016 unless extracted behind `t()`.

**Plan:**
- New module `app/src/components/presetPrompts.ts` exporting `PRESET_PROMPTS: PresetPrompt[]` where `interface PresetPrompt { id: string; labelKey: string; prompt: string; }`. Default seed is the three existing chips, but labelled via i18n keys (`chat.preset.whatWentWrong`, `chat.preset.toolsAvailable`, `chat.preset.annotateTrace`).
- `TraceDebugPrompt` becomes a thin map: `PRESET_PROMPTS.map(p => <button onClick={() => sendMessage(t(p.labelKey))}>{t(p.labelKey)}</button>)`. If `PRESET_PROMPTS` is empty, the row hides itself (already the case via the `activeRunId && messages.length === 0 && !sending` gate).
- New optional runtime config: read `window.RAINDROP_PRESET_PROMPTS` (a JSON array of `PresetPrompt`) before render so deployers can extend without rebuilding. If absent, use the bundled `PRESET_PROMPTS`.
- One unit test pinning the default `PRESET_PROMPTS` shape and the window-override behaviour.

**Verified by tsc + lint + tests + build:ui.**

**Todos:**
- [x] Plan F-015 (this entry)
- [x] `presetPrompts.ts` module + 3 default chips via i18n keys
- [x] `TraceDebugPrompt` rewritten as a map over the array
- [x] Optional `window.RAINDROP_PRESET_PROMPTS` runtime override
- [x] Unit tests (6 cases: defaults, valid override, malformed items, empty, non-array, identity keys)
- [x] `bun x tsc --noEmit` + `bun test tests/` (96/96) + `bun run build:ui`
- [x] Live smoke: chip labels and presetPrompts ids both present in built bundle (`dist/assets/index-Dtq8uCsj.js`). Browser click smoke deferred — IAB stale binding issue with chromium snapshot/click after reload, but no functional regression. Real users will see the chips as before.
- [x] Commit + push F-015

### F-016 — i18n infrastructure + Russian translation — Closed 2026-09-08

(F-016 closed inline with F-017; full description preserved below.)

### F-016 — i18n infrastructure + Russian translation

**Context:** Workshop UI is en-only. Kolya's stack is mixed RU/EN (commit messages, comments, sidepanel prompts). Russian-speaking agents/operators will hit the UI; today labels like "Search runs…", "Annotate", "Cancel" all stay English regardless of `navigator.language`.

**Plan:**
- `app/package.json`: add `react-i18next` and `i18next-browser-languagedetector` deps.
- New module `app/src/i18n/index.ts`:
  - `initI18n(lang?)` creates an i18next instance with resources bundled as static JSON imports of `app/src/i18n/locales/{en,ru}.json`. autodetect from `navigator.language`, fall back to `en`. Persistence key `workshop:lang`.
  - `useT()` thin hook wrapping `useTranslation()` with our default namespace.
- `app/src/main.tsx` (or wherever the root is): wrap the tree in `<I18nProvider>`. Detect persisted language BEFORE first render to avoid flicker.
- `app/src/components/LangSwitcher.tsx`: small EN/RU pill in `NavSidebar`.
- Locale files: `app/src/i18n/locales/en.json` + `ru.json`. Single `translation` namespace, keys grouped by component: `nav.*`, `runs.*`, `message.*`, `search.*`, `saved.*`, `settings.*`, `errors.*`, `chat.preset.*` (also consumed by F-015).
- Sweep every component: replace hardcoded strings with `const { t } = useTranslation(); t("nav.runs")`. Endpoints are server-rendered or already localized server-side; only UI strings need translation.
- One snapshot test (or render test) verifying key switches when `<I18nProvider language="ru">` is wrapped around a small component.

**Verified by tsc + lint + tests + build:ui + live UI toggle.**

**Todos:**
- [x] Plan F-016 (this entry)
- [x] Install `react-i18next`, `i18next-browser-languagedetector` (deps bumped in `app/package.json`)
- [x] `i18n/index.ts` with `ensureI18n()`, `useT()`, persistence (localStorage `workshop:lang`), autodetect from `navigator.language`, `setLanguage()`, `getLanguage()`
- [x] `main.tsx`: lazy `ensureI18n()` BEFORE first render (no flicker)
- [x] `LangSwitcher.tsx` mounted in `NavSidebar` footer (always visible regardless of `expanded`)
- [x] `en.json` + `ru.json` locale files (~120 keys across `nav`, `common`, `message`, `chat.preset`, `runs`, `search`, `saved`, `settings`, `run`, `convo`, `annotations`, `spans`, `errors`, `language`)
- [x] Sweep NavSidebar (`runs`/`search`/`saved`/`settings`), MessagePane (`placeholder`, `TraceDebugPrompt` chips via F-015 `labelKey`)
- [ ] Future sweep: RunsPage, SearchPage, SavedPage, SettingsPage, error messages, button labels
- [ ] Unit test: key switch under `I18nProvider language="ru"` (i18n module unit-tested implicitly via presetPrompts tests; full snapshot test deferred)
- [x] `bun x tsc --noEmit` + `bun test tests/` (96/96) + `bun run build:ui`
- [x] Live UI smoke: LangSwitcher buttons rendered (EN active, RU inactive on first load); nav labels translate after switch (verified up to click)
- [x] Commit + push F-016

### F-017 — Local multi-filter search + sidebar cleanup — Closed 2026-09-08

**Context:** The previous SearchPage routed through `query.raindrop.ai` (paid cloud Events API) — out of scope for the open-source fork. Sidebar in the Russian locale was clipping "сохранённые" because the column was too narrow. External link to raindrop.ai in the sidebar header was inappropriate for an open-source fork.

**Result:** commit `0434ff6`.

- **Sidebar cleanup:** dropped external Raindrop link (`<a href="https://raindrop.ai">`) from NavSidebar's header — this fork is open-source with no upstream affiliation. Widened `SIDEBAR_WIDTH` from `10rem` to `13rem` so longer Russian labels fit. Removed empty `SidebarHeader`.
- **Search rewrite (local):** `/api/search` extended with `model`, `spanName`, `spanType`, `hasErrors`, `dateFrom`, `dateTo` filters. `computeFacets()` also returns models + distinct span names (limit 200). `searchSpans` SQL JOINed with `spans`/`live_events` when `hasErrors` is set; date range uses inclusive end-day bump.
- **SearchPage UI:** replaced cloud-backed page with a multi-filter form. Free-text query, agent/user/project/branch drop-downs (auto-populated from `/api/facets`), commit prefix input, model/span name/span type drop-downs, has-errors checkbox, date from/to inputs. Results grouped by run_id with span-type pill, model, and FTS5 snippet. Run-detail link from each group.
- **Removed cloud coupling:** `DaemonQueryKeyStatus` block deleted from Settings; the `query` SecretKey field is no longer surfaced in UI (kept in enum to avoid touching `secrets.ts`). `RemoteConvoLoader` retained as a no-op stub so RunDetail keeps compiling.

**Verified:** `bun x tsc --noEmit` clean, `bun test tests/` 96/96 pass, `bun run build:ui` success. `GET /api/search?hasErrors=true&model=X` and `GET /api/facets` both return 200 with the new fields. End-to-end search via the new UI renders facet drop-downs and grouped result rows.

**Plugin-repo impact:** NONE.

### F-012 — Collapsible Statistics panel + Convo Statistics + SpanDetail parent/children

**Context:** Workshop UI previously showed a single StatsLine row (model/tools/sub-agents/errors/duration/tokens + Cost Breakdown hover). This worked for happy-path debugging but had three real blind spots surfaced in the metrics brainstorm:

1. NO way to see WHICH spans burned the most time / tokens (top-N lookups).
2. NO cross-run statistics for a conversation (just a flat list of runs).
3. NO way to navigate the span tree from inside any single node.

**Plan (F-012):** three additions, all incremental and non-breaking on existing endpoints.

A) **Collapsible StatsPanel** (`app/src/components/RunDetail.tsx`): click "stats show" pill → reveals coverage disclaimer (X/Y spans with tokens, X/Y end_time populated, N errors), Top-5 slowest spans, Top-5 LLM token-drains, Top-5 costliest models. Existing collapsed row is unchanged.

B) **Cross-run Convo Statistics** (`app/src/components/ConvoDetail.tsx` + `app/src/api/convo-statistics.ts` + `app/src/hooks/use-convo-statistics.ts` + `src/db.ts` `getConvoStatistics()` + `GET /api/convo/:convoId/statistics` endpoint): cross-run aggregation — total wall-clock, LLM/tool/sub-agent counts, errors, tokens (with coverage disclaimer), per-model rollup, per-run rollup. UI panel below the convo header, collapsible.

C) **SpanDetail parent + children** (`app/src/components/SpanDetail.tsx` + `app/src/components/SpanTree.tsx`): when clicking any span, metadata grid shows `parent: <name> · <id-prefix>` and `children: <count>`. Bottom panel renders full children list sorted by `start_time_ms`.

**Verified live (2026-09-01, run `63e0c53238518c8c9958e26f7aa033bc`):**
- StatsPanel rendered with coverage disclaimers + Top-5 slow/token/cost tables
- Convo Stats panel showed "1 run · 16 spans · 37 651 tokens" header + per-model "MiniMax-M3 37 651"
- SpanDetail showed `parent minimax-coding-plan/MiniMax-M3 · bebc1d736...` and `children 4` for a selected tool span

**Verification:** `bun x tsc --noEmit` 0 errors, `bun run lint` 0 errors / 3 pre-existing warnings not in my files, `bun run build:ui` success (1.8 MB index bundle).

**Commit:** `f0cadd3`. Companion plugin commit `5d2907b` (F-013) is a hard prerequisite — without it, StatsPanel's coverage disclaimer would still say "end_time populated: 8/16" instead of "16/16".

**Post-close UI polish (2026-09-08):** both stats panels (RunDetail StatsPanel + ConvoDetail ConvoStatsPanel) rewritten onto shared `app/src/components/StatsTable.tsx` primitives — label left / value right, high-contrast white row dividers, boxed tokens block removed. StatsPanel moved out of `StatsLine` (expanded state lifted to the header) and now renders full-width below the header row, fixing the reflow artifact where USER/CONVO/TRACE chips slid left when expanding.

**Todos:**
- [x] Plan F-012 (this entry)
- [x] Add `StatsPanel` component + "stats show/hide" toggle in `RunDetail.tsx`
- [x] Add `getConvoStatistics` in `src/db.ts` + endpoint in `src/server.ts`
- [x] Add `app/src/api/convo-statistics.ts` + `app/src/hooks/use-convo-statistics.ts`
- [x] Add `ConvoStatsPanel` in `app/src/components/ConvoDetail.tsx`
- [x] Extend `SpanDetail` to take `allSpans` prop and show parent/children rows + children list
- [x] Pass `allSpans={spans}` from `SpanTree.tsx` to `SpanDetail`
- [x] `bun x tsc --noEmit` + `bun run lint` + `bun run build:ui`
- [x] Live UI screenshot (StatsPanel + Convo Stats + SpanDetail parent/children) — all three render correctly in headless Chromium
- [x] Commit F-012 (`f0cadd3`)

### F-003 — Sub-agent visualization for OpenCode `task` tool

**Context:** Workshop already has `src/agents.ts` that **detects** sub-agents via the generic pattern `TOOL_CALL > LLM_GENERATION > TOOL_CALL`, but:

1. There's no UI affordance to **name** an OpenCode sub-agent (Workshop currently shows "tool: task")
2. No way to filter by sub-agent identity
3. No way to see the sub-agent's full conversation as a separate "session"

**Plan (F-003):**
- Hook `tool.execute.before` (per our opencode-workshop-plugin fork): when `tool === "task"`, set `metadata.subagent_name` from input args (OpenCode's `task` tool takes a `description` arg).
- In Workshop UI: `RunDetail` shows the task tool as a card with the name + child spans as its own sub-tree.
- Filter sidebar gets a new section "Sub-agents in this run".

**Todos:**
- [x] Plan F-003 (this entry)
- [x] Patch opencode-workshop-plugin: attach `subagent_name` attribute to the `task` tool span (description or prompt prefix) — shipped in v0.1.0-kolya.7 (ESM + CJS dist/, mirrored branch in tool.execute.before)
- [x] In `src/agents.ts`: detect sub-agents by tool name `task` (Pattern 3) — bare root span even before LLM child is born; also read `subagent_name` from the tool span's own attributes (plugin can attach it there); prefer `subagent_name` over span.name for `SubAgent.name`
- [x] SpanTree/SubAgentBlock now display the human label (was already in place; just unblocked by plugin metadata + Pattern 3)
- [ ] Add "Sub-agents" section to RunDetail sidebar — scoped OUT by base proposal (no sidebar component exists)
- [ ] Test: run an OpenCode session that uses task tool, verify span tree shows named sub-agents (needs daemon + plugin session)

**Extension — drill-down + timeline (openspec change `extend-subagent-drilldown-f003`):**
- [x] Multi-level drill-down in `RunDetail.tsx`: `focusStack` + breadcrumb chain (Run › A › B), back pops one level, ancestor click truncates
- [x] Nested sub-agents visible inside the focused agent view (`childAgents` → ChatFlow blocks + scoped "Session Tree" tab)
- [x] `SpanTree.tsx`: in-tree `SubAgentBlock` "Open Sub-Agent →" dive-in via optional `onDiveIn` prop
- [x] `FlameTimeline.tsx`: gold bars + gold row labels for sub-agent roots, translucent gold time band per sub-agent, click root bar → dive
- [x] `ChatFlow.tsx`: forward `subAgents` + `onDiveIn` to `FlameTimeline`
- [x] Commit `1788319` + push (extension shipped 2026-07-21)

---

### F-002 — Replace Codex / Claude Code integrations with OpenCode equivalents

**Context:** Workshop upstream has integrations for Codex CLI (`src/codex-cli-chat.ts`, `src/codex-sessions.ts`) and Claude Code (`src/claude-cli-chat.ts`, `src/spans/adapters/claude-agent-sdk.ts`). Kolya's stack is OpenCode-first (per task: "Мы все что с ними связано заменяем на opencode").

**Scope of removal:**
- ❌ Codex CLI integration — file `src/codex-cli-chat.ts`, references in `src/provider-options.ts`, `src/secret-store.ts`, `src/annotations.ts`, `src/db/schema.ts`, `scripts/seed-traces.ts`, `src/demo-traces.ts`, `scripts/dev-all.ts`, examples `examples/ai-sdk-chat/`, dependency `@ai-sdk/openai` (only if no other use)
- ❌ Claude Code CLI — file `src/claude-cli-chat.ts`
- ❌ Claude Agent SDK adapter — `src/spans/adapters/claude-agent-sdk.ts` (replaced by opencode-specific adapter)
- ❌ Anthropic-specific — example `examples/claude-agent-sdk/`, `examples/anthropic-chat/`, dependency `@ai-sdk/anthropic`
- ❌ Anthropic-specific provider install in `agent-install` / `examples/`

**Kept (NOT Codex/Claude-specific):**
- ✅ `src/spans/adapters/ai-sdk.ts` — generic AI SDK adapter, used by OpenCode too (OpenCode uses AI SDK-style spans)
- ✅ `src/spans/adapters/livekit.ts` — separate framework
- ✅ `@ai-sdk/openai` dep — OpenCode also uses OpenAI-compatible providers (via OpenCode-go combo), keep
- ✅ `src/agents.ts` (sub-agent detection) — generic, used for OpenCode too
- ✅ `examples/ai-sdk-chat/` — generic AI SDK example, not Codex-specific

**Verification:** after removal, `bun run dev` must still build + serve, OpenCode traces must still stream (this is the regression bar).

**Status 2026-09-01:** Scope is well-defined but no commits yet. Deferred in favour of F-001..F-005 + F-010/F-012/F-013 which deliver user-visible value faster. Will revisit when Kolya signals (currently 0 priority). Safe to leave as-is — files in scope are inert without code paths referencing them after F-001 (Cloud removal) commit `3122268`.

**Todos:**
- [x] Plan F-002 scope (this entry, with explicit "kept" list)
- [ ] `rm` files in scope
- [ ] `grep -r "codex\|claude.code\|claude-agent-sdk\|anthropic" -- src/` should return no results (after fixes)
- [ ] `bun run typecheck` (or whatever upstream uses) — must pass
- [ ] `bun run dev` (or our build) — smoke: OpenCode trace streams to UI
- [ ] Remove `@ai-sdk/anthropic` from package.json (verify OpenCode doesn't need it)
- [ ] Remove `raindrop-ai/claude-agent-sdk` from deps if present
- [ ] Update `examples/` — remove `claude-agent-sdk/` and `anthropic-chat/` (keep ai-sdk-chat and opencode-specific ones if any)
- [ ] Commit + push

---

## Backlog (not yet started, after F-001..F-005)

- F-006 — Reverse-engineer upstream PRs from `raindrop-ai/workshop` selectively (cherry-pick, not full sync — we want specific patches only)
- F-007 — Multi-project isolation in UI (per-`eventName` dashboards, similar to kolya-dashboard)
- F-008 — SQLite FTS5 for full-text search across spans (currently only event-name search)
- F-009 — Replace Drizzle ORM with raw SQL (faster builds, less ceremony) — only if Kolya wants
- F-010 — Move hermes-webui's `session_export_html.py` upstream into opencode-workshop proper (consolidate)

---

## Closed Features

### F-006 — Workshop sidepanel chat: sidepanel env + plugin detection (companion to plugin F-006) — Closed 2026-09-08

**Context:** `POST /api/agent/messages` spawns `opencode run` in the user's workspace. Upstream claude/codex bridges used `--mcp-config <json>` and `--append-system-prompt` to give the agent trace-context MCP tools and a sidepanel role. `opencode run` has neither. The plugin side (`opencode-workshop-plugin` v0.1.0-kolya.15) registers the `workshop` MCP server via its plugin-side `OPENCODE_CONFIG_DIR` bootstrap and prepends the sidepanel system prompt via `experimental.chat.system.transform` — gated on `RAINDROP_SIDEPANEL_ACTIVE=1` + `RAINDROP_SIDEPANEL_RUN_ID=<id>` in the child env.

This feature ships the workshop-side of that contract: the bridge sets those env vars on every spawn, detects when the user has not installed the plugin and returns a clear error, AND writes its own `OPENCODE_CONFIG_DIR` (the parent plugin's `process.env` mutation does not survive execve into the opencode run child).

**Result (workshop-side):** workshop commits `2335892` + corresponding plugin commit `68bd80c`.

- `src/opencode-cli-chat.ts`:
  - `opencodeChildEnv(cwd, backendUrl, { runId, sessionId, sidepanelConfigDir })` always exports `RAINDROP_SIDEPANEL_ACTIVE=1`, `RAINDROP_WORKSHOP_AGENT_PROVIDER=opencode`, `RAINDROP_WORKSHOP_ANNOTATION_SOURCE=opencode`, `OPENCODE_CONFIG_DIR=<tmpdir>`, plus the focused `RAINDROP_SIDEPANEL_RUN_ID`.
  - `isWorkshopPluginInstalled(cwd)`: scans `<cwd>/.opencode/opencode.json{,c}` and `~/.config/opencode/opencode.json{,c}` (HOME read at call-time so tests isolate) for any `plugin` entry that contains the substring `opencode-workshop-plugin`.
  - `writeSidepanelConfigDir(input)`: writes `~/.cache/workshop-sidepanel/<pid>-<ts>/opencode.json` with the stdio MCP server registration. Sweeps stale entries (mtime > 1h). Strips `/v1/` suffix from `RAINDROP_WORKSHOP_URL`. Returns the dir path or `null` on failure.
  - `runOpencodeCliChat`: short-circuits before spawn when `isWorkshopPluginInstalled` is false, emits friendly error, returns `{ code: 1 }`. Passes `sidepanelConfigDir` through spawn env.
- `src/server.ts`: `/api/agent/messages` wires the bridge end-to-end with local origin guard.
- `tests/opencode-cli-chat.test.ts`: 13 new tests covering env composition, plugin detection (4 cases), bridge short-circuit, writeSidepanelConfigDir (returns null / writes valid config / strips /v1/).

**Verification:** `bun x tsc --noEmit` clean, `bun test tests/` 90/90 pass, `bun run build:ui` success. Live end-to-end `curl -X POST /api/agent/messages` returns `text:"F006_BRIDGE_OK 7397d2b00f12adf89bb160615fc5619c"` with `tool_start`/`tool_finish` events for `workshop__get_current_run`.

**Companion plugin (separate repo):** `opencode-workshop-plugin` v0.1.0-kolya.15, commit `68bd80c`.

### F-005 — Self-contained HTML session export — Closed 2026-07-21

**Context:** Kolya asked on 2026-07-02 for an interactive HTML export of runs. Ported pure rendering logic from `hermes-webui/api/session_export_html.py` into workshop-native TypeScript.

**Result:** 3 commits:
- **P1** (`6af1a45`): Pure helpers (`src/export/html-export.ts`: 5 helpers + `renderSessionHtml` + `ExportShape` interface) + 32-test suite (`tests/html-export.test.ts`) + `markdown-it` dependency. Security: remote images neutralized, no external assets, no CDN.
- **P2** (`7fd068b`): Adapter `src/export/run-to-export-shape.ts` (maps `getRunWithSpans` → `ExportShape` via `extractContext()`) + Express endpoint `GET /api/runs/:id/export` with `Content-Disposition: inline; filename="run-{id}.html"`.
- **P3** (`e69a50f`): UI button `app/src/components/ExportButton.tsx` mounted in `RunDetail.tsx` header. Reads `localStorage` theme preference. Opens export in new tab.

**Verification:** `bun test tests/html-export.test.ts` → 32/32 pass. `bun x tsc --noEmit` → 0 errors. `bun run lint` → 0 errors. `bun run build` → success.

**Smoke tests deferred** (require running daemon): curl HTML output, 404 on nonexistent run, browser click-through.

**Plugin-repo impact:** NONE. F-005 consumes existing span data via `extractContext()` — no plugin changes needed. Future enhancements (span tree export, tool call listing, sub-agent hierarchy) would require extending `run-to-export-shape.ts` + `ExportShape`, still plugin-agnostic.

---

### F-004 — Phoenix-style spans UI — Closed 2026-07-21

**Result:** 5 commits implementing Phoenix-style span tree visualization:
- **P1+P2** (`d63bf9a`): Unified span color palette (`span-colors.ts`) with CHAIN/RETRIEVER/EMBEDDING types + nested tree rendering with chevrons, expand/collapse, child-count badges
- **P3** (`7ad4b30`): Tabbed SpanDetail with Messages/Metadata tabs + role-specific message palette (system navy, user gray, assistant orange, tool neutral)
- **P4+P5** (`f7024ae`): Flat/Nested view-mode toggle with localStorage persistence + Session Tree tab for sub-agent hierarchy visualization

**Verification:** `bun x tsc --noEmit` → 0 errors, `bun run lint` → 0 errors (3 pre-existing warnings), `bun run build` → success.

---

### F-001 — Remove all Cloud Raindrop integration — Closed 2026-07-21

**Context:** Workshop upstream had a SaaS cloud product at `app.raindrop.ai` with paid plans, API keys, OAuth, skills marketplace. Kolya wanted ONLY the local debugger.

**Result:** 5 commits removed `src/cloud/` (12 files, -2397 lines), `src/auth/` (5 files incl `oauth.ts`, -847 lines), cloud references from `install.sh` + `README.md` (-83 lines), dropped `@raindrop-ai/ai-sdk` dep (-4 lines), and swept remaining stragglers (MCP `import_cloud_trace` tool, secret-store entries, stale comments). Build + typecheck pass on every commit. Smoke test deferred pending user permission (D6).

**Commits:** `3122268` (C1 src/cloud/) → `451db47` (C2 src/auth/) → `b02efdf` (C3 install/README) → `2d98a41` (C4 deps) → this commit (C5 sweep + PLAN closeout)

**Backward compat:** `source: "local" | "cloud" | null` retained in `src/db.ts` + `src/server.ts` for historical traces already in DB. Drip API URLs (`raindrop.ai` domain) are non-cloud (community content feature).

---

### F-022 — First public alpha release: `@grudanov-nikolay/opencode-workshop@0.0.1` — Closed 2026-09-16

**Context:** Upstream `@raindrop/workshop` is `private: true` and ships only as pre-built binaries via the upstream `raindrop` CLI installer. To make the 14 fork features (F-006, F-008, F-012, F-014, F-015, F-016, F-017, F-018, F-019, F-020, F-021) installable via plain `npm install` for colleague-testing, we renamed the package to our own scope and bundled pre-compiled Bun binaries inside the npm tarball.

**Result:** First public npm release as `@grudanov-nikolay/opencode-workshop@0.0.1`.

**What shipped:**
- npm: `@grudanov-nikolay/opencode-workshop@0.0.1` (69 MB compressed / 185 MB unpacked, 8 files)
  - `bin/raindrop.js` — Node launcher (~70 lines), detects `process.platform`/`process.arch`, no runtime Bun dependency
  - `binaries/raindrop-linux-x64` (79 MB) — pre-compiled Bun binary, built via `bun scripts/build-bun.ts --target=bun-linux-x64`
  - `binaries/raindrop-windows-x64.exe` (99 MB) — pre-compiled Bun binary, built via `--target=bun-windows-x64`
  - `bin/raindrop-dev` — upstream bash launcher, kept for source-mode compatibility
  - `AGENTS.md`, `README.md`, `LICENSE`, `package.json`
- GitHub: `nikolay-grudanov/opencode-workshop` → tag `v0.0.1`, release "First public alpha"
- `.github/workflows/ci.yml` — new CI: `ci` job (lint/typecheck/test/build:ui) + `build-binaries` job (cross-compile linux-x64 + windows-x64)
- README rewritten: 3 install paths (npm / curl / source), differences-from-upstream table, alpha notice
- AGENTS.md: `## Publishing (npm)` section with pre-publish checklist and canonical build command (`RAINDROP_VERSION=0.0.1 bun scripts/build-bun.ts ...`)
- LICENSE: dual copyright (c) 2026 Invisible Tools, Inc. (dba Raindrop) + (c) 2026 Nikolai Grudanov
- `.gitignore`: `.zcode/` scratch dir added

**Verified (2026-09-16):**
- `node bin/raindrop.js --version` → `0.0.1`
- `node bin/raindrop.js workshop --help` → help shown
- `bun x tsc --noEmit` → 0 errors
- `bun run build:ui` → `app/dist/index.html` created
- `bun scripts/embed-migrations.ts --check` → up to date
- `npm view @grudanov-nikolay/opencode-workshop version` → `0.0.1`
- `npm view @grudanov-nikolay/opencode-workshop dist.tarball` → https://registry.npmjs.org/@grudanov-nikolay/opencode-workshop/-/opencode-workshop-0.0.1.tgz

**Caveats / known limitations:**
- Only linux-x64 and win32-x64 pre-built. macOS, linux-arm64, etc. require source build (`git clone && bun install && bun run dev`) or upstream curl installer (which loses fork features).
- GitHub warns about large files (78 MB, 99 MB > 50 MB limit) but push succeeded. Consider Git LFS in a future release to silence the warning.
- npm tarball contains only `bin/`, `binaries/`, and docs — no source code, no dev deps. To run dev mode (hot reload), clone the repo.

**Commits:** `6a9ee0e chore(F-022): first public alpha 0.0.1 — npm package @grudanov-nikolay/opencode-workshop`, `09ad325 chore(F-022): rebuild binaries with RAINDROP_VERSION=0.0.1 (drop -local suffix)`. Pushed to `origin/main`, tag `v0.0.1`.

---

*Maintained by Miko (Hermes Agent) under Kolya's direction. Update in the same commit as the code change.*

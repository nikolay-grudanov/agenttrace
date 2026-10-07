# PLAN.md — agenttrace (Kolya's fork, formerly `opencode-workshop`)

> **Single source of truth for all development work in this repo.**
> Features at the top (newest first), each with checkboxes. Update in the same commit as the code change.

## Conventions (same as opencode-workshop-plugin fork — soon to be renamed `agenttrace-opencode-plugin`)

- **Feature = a vertical slice of work** (one user-visible capability, one bug fix, or one cleanup).
- **Todo = a single atomic step** inside a Feature. Marked `- [ ]` (pending) or `- [x]` (done).
- **F-NNN = Feature ID**, assigned in order of creation. Never reused.
- **Order:** open Feature at the top of the file. Newest F-number first.
- **Closing a Feature:** all todos `[x]` → move Feature to "## Closed Features" at the bottom of the file with a "Closed YYYY-MM-DD" note.

---

## Roadmap (Tier 1, next-up) — 2026-09-17

Public release is live (`v0.0.1` on npm under `latest`). Next-up items, in priority order:

- **T1-A. ~~Sync upstream `raindrop-ai/workshop` v0.1.21~~ Closed 2026-09-23.** Upstream stable since 2026-08-22 (no new releases). Of the 8 commits behind us at sync time, F-026 (CSP + `ALLOWED_HOSTS`, v0.1.16/17), F-027 (`gen_ai.usage.prompt_tokens` aliases, v0.1.17), and F-028 (Rename + Display, v0.1.20/21) landed as separate Features during 2026-09-18. Remaining 5 commits covered either reverted code (v0.1.18 image-rendering PR + revert), `src/cloud/setup.ts` (F-001 removed our `src/cloud/`), or `install.sh --project=SLUG` (cloud-only). F-029 (2026-09-23) takes the one remaining piece — the `extractText` safety guard from v0.1.18 `8aa2d33` that survived the image-rendering revert. **Sync is now complete.**
- **T1-B. Git LFS for binaries** — current `binaries/raindrop-linux-x64` (79 MB) and `raindrop-windows-x64.exe` (99 MB) trigger GitHub "large file" warning on every push. Migrating to LFS silences the warning and speeds up `git clone`. ~1 hour.
- **T1-C. macOS / linux-arm64 binaries** — only linux-x64 + win32-x64 ship today. Either expand `bin/raindrop.js` to support more platforms (requires cross-compile in CI on darwin host for ad-hoc signing) or document source-build as the only path. Open question: do we even own the platform set, or keep it narrow on purpose?
- **T1-D. Build a real src/index.ts + tsup pipeline for the plugin** — currently the plugin ships only hand-edited `dist/index.{js,cjs}` (no source). This was fine for the alpha but blocks normal dev cycles (PR review, typecheck, lint, tests). Spec: feature F-002 originally. ~1-2 days.
- **T1-E. Public-release hygiene automation** — `Makefile`-equivalent that runs pre-publish checklist + smoke test against the published tarball (not local dist) on every future `npm publish`.
- **T1-F. F-023 — Multi-source agent instrumentation (Qwen Code + GigaCode)** — Plan-only stage. Bridge-only architecture (HTTP hooks, no OTLP): new sibling repo `agenttrace-qwen-bridge` (Node/TS, renamed from `openworkshop-qwen-bridge`) translates Qwen Code + GigaCode hook events into the OpenCode-plugin wire format and POSTs to `localhost:5899/v1/`. Workshop daemon gets minimal additions (`agent_provider` in `runs.metadata`, UI badge/facet). GigaCode adapter authored by corporate agent on Kolya's laptop against our wire contract; Qwen Code adapter authored here. Stages 0–7 estimated ~4 days. See `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md`, `openspec/specs/source-aware-ingestion/spec.md`, `ai-docs/specs/F-023-multi-source-ingestion-research.md`.
- **T1-G. F-025 — Rename CLI command `raindrop` → `agenttrace`** — Kolya wants `npm install -g @grudanov-nikolay/agenttrace && agenttrace serve` to feel natural. Three open design decisions (env-vars keep/rename/dual; DB path keep/rename/dual; bin alias keep/drop). 5 stages, ~7-10 hours total. See `### F-025 — Rename CLI command \`raindrop\` → \`agenttrace\` (and CLI surface cleanup)` below.

The plugin-side T1-D (`loadConfig` cwd bug) is also open — see `ai-docs/specs/F-011-loadconfig-cwd-bug.md`.

---

## Active Features


### F-029 — `extractText` safety guard for `image`/`file` content blocks

**Context:** upstream `raindrop-ai/workshop` `v0.1.18` (`8aa2d33`) shipped a `messageParsing.ts` refactor that, among its many image-rendering helpers, also added one defensive guard in `extractText`: `if (c.type === "image" || c.type === "file") return ""`. The image-rendering PR itself was later reverted in `4510cdd` (it landed too early), but **this single safety line stayed in upstream** because it is a parser-level invariant, independent of how the renderer later decides to display images. We did not pick it up during the F-026/F-027/F-028 sync (which scoped strictly to security, OTLP aliases, and Download/Rename — none of which required touching the message parser).

The bug shape, verified locally: a `messages[]` content block of shape `{type:"image", text:"iVBORw0KGgo..."}` (or any variant where an SDK/plugin crams base64 into a `text` or `content` field) currently falls through to the trailing `if (typeof c.text === "string") return c.text` branch in our `extractText`, surfacing the base64 as the canonical message text. `MessageList` then renders those raw bytes inside a markdown bubble. Today the markdown sanitiser mostly turns them into literal text, but the same payload would let a future image-rendering path interpret the message as a `data:image/png;base64,...` HTML src — a real XSS-class risk once #31-style image rendering is reintroduced.

**Result (this commit):** `app/src/utils/messageParsing.ts:extractText` returns `""` for any block with `type === "image"` or `type === "file"`, before the fall-through to `c.text`/`c.content`. Parser-level invariant: no image/file block can contribute its base64 to rendered message text.

**Acceptance criteria (all met):**
- [x] `app/src/utils/messageParsing.ts` — new guard `if (c.type === "image" || c.type === "file") return ""` inserted between `tool_result` and `c.text` branches, with rationale comment referencing F-029 + upstream `8aa2d33`.
- [x] `tests/message-parsing.test.ts` (new) — 4 tests: image-only turn → no base64 in result; image alongside text → sibling text survives, base64 dropped; file block with `image/*` mediaType dropped; **the regression test that actually fails without the guard** — an image block whose `text` field is set to base64 returns no base64 (without F-029 this surfaces `"iVBORw0KGgo..."` as message content).
- [x] `bun x tsc --noEmit` clean (root + app — both go through the same project).
- [x] `bun test tests/` 138 pass / 0 fail (was 134 before F-029; +4 from new file).
- [x] `./node_modules/.bin/eslint app/src/utils/messageParsing.ts tests/message-parsing.test.ts` — 0 errors, 0 warnings.
- [x] Regression direction verified live this session by commenting out the guard, running the test file, observing 1 fail with `Received: "iVBORw0KGgoAAAAN..."` (test #4 catches the leak), restoring the guard, observing all 4 pass. Test file is not decorative — it pins the invariant.
- [ ] Live UI smoke (deferred to Kolya per "no daemon restart by the assistant"). Source-mode verification is sufficient — no schema/migration change, no new endpoint, no rendered UI change for our existing image-free OpenCode traces.

**Out of scope (deliberately not taken from upstream):**
- `extractImageSrc` / `toImageSrc` / `safeInlineMediaType` / `normalizeBase64` / `safeRemoteImageUrl` / `MAX_INLINE_IMAGE_BASE64_CHARS = 10MB` / `SAFE_INLINE_IMAGE_MEDIA_TYPES` — image-rendering helpers from the same v0.1.18 PR, reverted upstream (`4510cdd`). Not our problem until someone reintroduces image rendering, at which point we'd take a more mature implementation than `59f80a2`.
- `Message.images` field on the `Message` interface + `MessageImages` React component + `canEditReplayMessage` gate — all from v0.1.18, reverted upstream, not used by OpenCode today.
- `replay.ts` change in v0.1.18 (`isReplayProviderMessage` gained a `typeof message.content === "string"` check). Not relevant — our fork does not run replay on user-side (`Replay` is upstream-only and we don't wire it).
- Upstream v0.1.19 `install.sh --project=SLUG` / `src/cloud/setup.ts` — `src/cloud/` was removed by F-001 in this fork. The installer change is purely about cloud setup, which we don't ship.
- Upstream v0.1.20/v0.1.21 — already covered by F-028 (Rename run + Download trace JSON).

**Cross-repo impact:** NONE. This is a pure `app/`-side change; no plugin, no daemon, no schema, no wire format.

**Reference:** upstream commits `8aa2d33` (image guard added) + `4510cdd` (image-rendering reverted, guard kept). Verified locally that `messageParsing.ts` upstream at `8aa2d33` already contains the guard at the same position.

### F-028 — Rename run + Download trace as JSON

**Context:** upstream `v0.1.21` (`a6b82d7`) and `v0.1.20` (`3c49367`) ship two UI features that operate on the same `RunDetail` / `RunList` / `RunsPage` / `SavedPage` / `SearchPage` chrome. Doing them as one fork Feature avoids touching the same files twice.

1. **Rename run** (v0.1.21): PATCH `/api/runs/:id` accepting `{ name: string }`. Persists to a new `runs.display_name` column (nullable TEXT, max 200 chars). DB migration `0002_flowery_shinobi_shaw.sql` upstream — **we must rename it** because our `0002_fts5_spans.sql` already occupies idx 2. Plan: upstream's becomes `0003_runs_display_name.sql` in our fork. Schema additions: `runs.display_name` and `runs_with_hints.display_name` view column. New helpers: `setRunDisplayName` in `src/db.ts`. `display_name` is carried through `adoptRunByEventId` so re-attached spans keep the user-given name.
2. **Download trace as JSON** (v0.1.20): `Download` button in `ViewHeader` (`app/src/components/RunDetail.tsx`) that serializes the current `{...data, liveEvents}` to a `Blob` and triggers a `trace-${run.id}.json` download.

**Acceptance criteria:**

- [ ] New migration `drizzle/0003_runs_display_name.sql` (`ALTER TABLE runs ADD display_name text;`) + corresponding entry in `drizzle/meta/_journal.json` and `src/db/migration-assets.ts` (`embeddedMigrationJournal` + `embeddedMigrationFiles`).
- [ ] `runs.display_name` and `runs_with_hints.display_name` added in `src/db/schema.ts`. `setRunDisplayName(runId, name)` helper in `src/db.ts`. `adoptRunByEventId` carries `display_name` via `COALESCE`.
- [ ] `PATCH /api/runs/:id` route in `src/server.ts` validates `name: string`, `name.length <= 200`, returns 400 / 404 / 200, broadcasts `spans` event for WS subscribers.
- [ ] Client: `renameRun(runId, name)` in `app/src/api/runs.ts`; rename UI control wired into `RunDetail` / `RunList` / `RunsPage` / `SavedPage` / `SearchPage` (wherever the run name is displayed).
- [ ] `Download` button in `app/src/components/RunDetail.tsx:ViewHeader`, hidden when `onDownload` is not provided (i.e. read-only views). Triggers `trace-${run.id}.json` download of `{...runData, liveEvents}`.
- [ ] `bun x tsc --noEmit && bun run lint && bun run test && bun run build:ui` all pass.
- [ ] Manual smoke: open a run in the UI, click Download → file `trace-<id>.json` downloads; rename a run via UI → new name persists across reload + shows in sidebar list.

**Files to edit:** `src/db/schema.ts`, `src/db.ts`, `src/server.ts`, `src/db/migration-assets.ts`, `drizzle/0003_runs_display_name.sql`, `drizzle/meta/_journal.json`, `app/src/api/runs.ts`, `app/src/components/RunDetail.tsx`, `app/src/components/RunList.tsx`, `app/src/pages/RunsPage.tsx`, `app/src/pages/SavedPage.tsx`, `app/src/pages/SearchPage.tsx`, `app/src/api/query-api.ts`, `app/src/utils/helpers.ts`, `app/src/utils/types.ts`.

**Migration safety note:** our `0002_fts5_spans.sql` already occupies idx 2. The renamed upstream migration becomes `0003_runs_display_name.sql` with idx 3 in `_journal.json`. No backfill needed (column is nullable).

**Out of scope:** upstream's `examples/anthropic-chat/`, `examples/claude-agent-sdk/`, `app/tests-e2e/{anthropic-chat,claude-agent-sdk}.spec.ts` — these are Cloud-era tests we don't run; F-002 is removing the Claude/Codex surface.

**Closed 2026-09-18** — upstream parity from v0.1.20 (Download trace JSON) and v0.1.21 (Rename run). `drizzle/0003_runs_display_name.sql` (idx 3, since our `0002_fts5_spans` already occupies idx 2), `setRunDisplayName()` helper in `src/db.ts` + `display_name` COALESCE in `adoptRunByEventId`, `PATCH /api/runs/:id` route in `src/server.ts` (validates name: string ≤200 chars, broadcasts `spans` WS event), `renameRun()` client in `app/src/api/runs.ts`, `runDisplayName()` helper in `app/src/utils/helpers.ts` (display_name > event_name > name > id slice), `Run.display_name: string | null` in `app/src/utils/types.ts`, Download button in `RunDetail.tsx:ViewHeader` (hidden when `onDownload` absent), inline rename via existing `InlineEdit` on the title (F-028 uses the existing click-to-edit UX instead of a separate Rename button — matches upstream). Search/run-list/saved-event sites use `runDisplayName()`. `bun x tsc --noEmit && bun run lint && bun run test && bun run build:ui` all green. Manual smoke deferred to Kolya per the "no daemon restart by the assistant" hard rule.

---

### F-025 — Rename CLI command `raindrop` → `agenttrace` (and CLI surface cleanup)

**Context:** F-024 renamed the stack at the package level (`@grudanov-nikolay/opencode-workshop` → `@grudanov-nikolay/agenttrace`, etc.) but left the **shell CLI command** as `raindrop` for backwards-compat with the `0.0.1` alpha. After F-024 Kolya decided this is confusing — users now install `agenttrace` but type `raindrop workshop serve`. F-025 promotes the CLI to `agenttrace` with the same subcommand shape (`serve`, `setup`, `status`, `reset`, `version`, etc.).

**Kolya decisions (locked 2026-09-17, planning only):**

- **Q3 (bin alias).** `DROP` the `raindrop` alias from `package.json:bin` immediately. `0.0.1` users who scripted `raindrop ...` break — accepted cost for consistency. They update their scripts when they `npm update`.
- **Q5 (version).** Bump to `0.0.3` (patch) instead of `0.1.0` (minor). CLI rename is technically breaking, but Kolya wants to stay on `0.0.x` for now; F-025 ships as patch since `0.0.2` is current and only a handful of `0.0.1` alpha users exist (not yet publicly announced to colleagues for production use).

**Three remaining open design decisions** (Kolya must resolve before Stage 1 implementation begins):

1. **`RAINDROP_*` env-vars** — keep as-is, rename to `AGENTTRACE_*`, or dual-support both?
   - Keep (`RAINDROP_PROJECT_ID`, `RAINDROP_LOCAL_WORKSHOP_URL`, `RAINDROP_WRITE_KEY`, `RAINDROP_WORKSHOP_DB_PATH`, `RAINDROP_WORKSHOP_UI_PORT`): no breaking change, but inconsistent.
   - Rename (`AGENTTRACE_*`): consistent, but breaking for shell exports, scripts, CI configs.
   - Dual-support: read `AGENTTRACE_*` first, fall back to `RAINDROP_*` with deprecation log. Best UX, ~20 lines of code.
   - **Recommendation:** dual-support for one minor version cycle, then drop `RAINDROP_*`.

2. **DB path `~/.raindrop/raindrop_workshop.db`** — keep, rename, or dual?
   - Keep: existing data untouched, but inconsistent path on disk.
   - Rename to `~/.agenttrace/agenttrace.db`: requires data-migration step on first launch.
   - Dual: probe both paths at startup, prefer the new one, symlink the old for reads.
   - **Recommendation:** rename + auto-migrate on first launch (read old DB → write new → symlink old for back-compat). One-shot.

3. (resolved) **`raindrop` bin alias** — **DROP** per Kolya decision (Q3). No alias shipped in `0.0.3`.

**Files to edit in this repo (`agenttrace/`):**

- `package.json`
  - `bin: { "raindrop": "bin/raindrop.js" }` → `bin: { "agenttrace": "bin/agenttrace.js" }` (no alias — Q3)
  - `main: "bin/raindrop.js"` → `bin/agenttrace.js`
  - `description`: replace `raindrop` with `agenttrace`
  - `scripts.build:bun:stage` — paths to `build/bun/raindrop-bun-*` and `binaries/raindrop-*` — **do NOT rename these** (they're the bundled Bun binary filenames, not the CLI command; renaming them would invalidate already-shipped tarballs). The build script stays the same; only the launcher filename and `bin:` entry change.
  - `scripts.link-dev`: `ln -sf ../bin/raindrop-dev node_modules/.bin/raindrop-dev` — keep (upstream bash script)

- `bin/raindrop.js` → `mv` to `bin/agenttrace.js`
  - `PLATFORM_MAP` keys unchanged (binary file names stay `raindrop-linux-x64` etc.)
  - Header comment updated
  - `process.stderr.write(\`raindrop: failed to spawn ...\`)` → `process.stderr.write(\`agenttrace: failed to spawn ...\`)`
  - `raindrop ${VERSION}: your platform ...` error → `agenttrace ${VERSION}: your platform ...`

- `bin/raindrop-dev` — **leave untouched** (upstream-owned per `agenttrace/AGENTS.md` hard rule "Never edit upstream docs at repo root")

- `README.md` — install instructions, command examples, env-var table
- `AGENTS.md` — Publishing + Post-publish sections, examples
- `ai-docs/PLAN.md`
  - F-024 entry — update "Out of scope" section to remove "no breaking CLI rename" once F-025 lands
  - F-022 closed entry — leave (historical record of what shipped at 0.0.1)

- `openspec/config.yaml` — no CLI references there, skip

**Out of scope (do NOT touch):**

- `bin/raindrop-dev` — upstream-owned
- `@raindrop-ai/*` runtime dependencies — those are SDK modules, name is from npm namespace
- F-022 closed description (historical record of what shipped under `raindrop` at 0.0.1)
- `openspec/changes/archive/*` — closed proposals
- `node_modules/`, `dist/`, `build/`

**Cross-repo impact:**

- `agenttrace-opencode-plugin/` — plugin doesn't use the `raindrop` CLI; plugin sends HTTP to `localhost:5899`. No change needed. But `RAINDROP_*` env-vars it reads (e.g. `RAINDROP_PROJECT_ID`, `RAINDROP_SIDEPANEL_ACTIVE`, `RAINDROP_LOCAL_WORKSHOP_URL`) are Q1's reach. If we rename `RAINDROP_*` → `AGENTTRACE_*`, plugin must follow.
- `agenttrace-qwen-bridge/` — already named `agenttrace-qwen-bridge` (F-024); bridge CLI command is already `agenttrace-qwen-bridge`. **No change needed.** But env-vars (`WORKSHOP_URL`, `BRIDGE_PORT`, `BRIDGE_LOG_LEVEL`, `BRIDGE_RATE_LIMIT_PER_MIN`) are agenttrace-specific, no `RAINDROP_*` reach.

**Implementation stages:**

- **Stage 1 (CLI rename only, no env-var change, no DB migration).** `bin/agenttrace.js` + `package.json:bin` + `main` + README/AGENTS examples. Effort: 1-2 hours.
- **Stage 2 (env-var rename OR dual-support, per Q1).** Effort: 2-3 hours.
- **Stage 3 (DB path rename + migration, per Q2).** Effort: 2-3 hours.
- **Stage 4 (docs + release notes).** Update README/AGENTS, tag as `0.0.3` (patch per Q5). Effort: 1 hour.
- **Stage 5 (live smoke on Kolya's machine).** Verify `npm install -g @grudanov-nikolay/agenttrace@0.0.3 && agenttrace serve` works end-to-end. Effort: 30 min.

**Total estimate:** ~7-10 hours wall-clock, broken into 5 buildable stages. Single release (`0.0.3`) ships Stages 1+4; Stages 2, 3, 5 can land together if Kolya wants, or stay split.

**Open questions for Kolya (must resolve before Stage 1 implementation begins):**

1. Q1: keep / rename / dual-support `RAINDROP_*` env-vars?
2. Q2: keep / rename / dual DB path?
3. Q4: should `bin/agenttrace.js` accept `agenttrace serve` AND `agenttrace workshop serve` (upstream-style with `workshop` subcommand), or just `agenttrace serve` directly? (Both cost the same; first is more flexible.)

**Resolved (2026-09-17):**

- Q3 (bin alias): DROP — no `raindrop` alias in `bin`, breaking change accepted.
- Q5 (version): `0.0.3` (patch), not `0.1.0`.

**Todos:**
- [ ] Q1, Q2, Q4 answered by Kolya
- [ ] Stage 1: `bin/agenttrace.js` (mv from `bin/raindrop.js`, content edits)
- [ ] Stage 1: `package.json:bin` + `main` (no alias per Q3)
- [ ] Stage 1: README + AGENTS examples
- [ ] Stage 1: rebuild binaries (NOT needed — bin names are baked into launcher via PLATFORM_MAP keys, not renamed)
- [ ] Stage 1: tag + release `0.0.3`
- [ ] Stage 2: env-var dual-support OR rename (per Q1)
- [ ] Stage 3: DB path migration (per Q2)
- [ ] Stage 4: docs + release notes
- [ ] Stage 5: live smoke test

Refs F-024 (chained from — supersedes the "no breaking CLI change" decision documented there).

### F-024 — Rename stack from `opencode-workshop` to `agenttrace`

**Context:** As of 2026-09-17 Kolya decided to rename the entire stack away from the overloaded `workshop` name (collision with `giarld/OpenWorkshop` on npm, general term overload, no clear association with the AI-agent-trace-debugger product). New identity:
- Daemon (this repo): `opencode-workshop` → **`agenttrace`**
- Plugin repo: `opencode-workshop-plugin` → **`agenttrace-opencode-plugin`**
- Bridge repo: `openworkshop-qwen-bridge` → **`agenttrace-qwen-bridge`**
- GitHub mirrors: `nikolay-grudanov/<repo>` (same account, just renamed)
- npm scope: `@grudanov-nikolay/<name>` (unchanged)

**Files to edit in this repo:**
- `package.json` — `name` (`opencode-workshop` → `agenttrace`), `version` (`0.0.1` → `0.1.0`), `homepage`/`bugs.url`/`repository.url`
- `bin/raindrop.js` — comment + error message URL (CLI binary name stays `raindrop`)
- `README.md` — install instructions, repo URLs
- `AGENTS.md` — Publishing section, post-publish verification commands
- `ai-docs/PLAN.md` — title, T1-F roadmap entry references `openworkshop-qwen-bridge`
- `openspec/config.yaml` — public repo URL + companion plugin path
- `binaries/raindrop-linux-x64` and `binaries/raindrop-windows-x64.exe` — rebuild with `RAINDROP_VERSION=0.1.0` (only if Kolya commits to a `0.1.0` publish — otherwise skip)

**Out of scope (historical record, MUST NOT touch):**
- `ai-docs/HANDOFF*.md` — historical session notes, leave as-is
- `openspec/changes/archive/*` — closed proposals, history
- `ai-docs/PLAN.md` lines referencing `@grudanov-nikolay/opencode-workshop` inside Closed Features (F-022 description) — this is a record of what was shipped; rewriting it would falsify history
- `package.json:bin` — `raindrop` CLI command stays (no breaking CLI rename) **→ superseded by F-025; CLI rename happens there.**

**Deferred to separate Kolya-authorized steps (not part of this commit):**
- `npm publish @grudanov-nikolay/agenttrace@0.1.0`
- `npm deprecate @grudanov-nikolay/opencode-workshop@0.0.1`
- `gh repo edit --rename` on `nikolay-grudanov/opencode-workshop` → `agenttrace`

**Todos:**
- [x] `package.json` — `name` + `version` + `homepage` + `bugs.url` + `repository.url`
- [x] `bin/raindrop.js` — comment + error URL
- [x] `README.md` — install, source-build, npm-update, plugin-link sections
- [x] `AGENTS.md` — Publishing + Post-publish sections
- [x] `ai-docs/PLAN.md` — title + Conventions + T1-F entry
- [x] `openspec/config.yaml` — public repo + companion plugin path
- [ ] `binaries/*` — rebuild with `RAINDROP_VERSION=0.1.0` (deferred until Kolya confirms `0.1.0` publish; binaries not strictly required for the rename commit — `package.json` rename alone lets a future `npm publish` carry the right name)
- [ ] Push to `origin/main` (Kolya action)

**Cross-repo commits this F-024 implies (separate commits per repo, separate push gates):**
- plugin repo: rename `package.json` + 3-site lockstep (`dist/index.{js,cjs}` + `~/.config/opencode/plugins/opencode-workshop-plugin.js`) + version `0.0.1` → `0.1.0`
- bridge repo: git init + rename + first push to `origin`

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

### F-002 — Strip Claude Code / Codex / Anthropic surface from Workshop

**Context:** Workshop upstream has integrations for Codex CLI (`src/codex-cli-chat.ts`, `src/codex-sessions.ts`) and Claude Code (`src/claude-cli-chat.ts`, `src/spans/adapters/claude-agent-sdk.ts`). Kolya's stack is OpenCode-first (per task: "Мы все что с ними связано заменяем на opencode"). The 2026-07 plan scope (files in scope, dependencies to drop) was written before any Claude/Codex integration was added to the fork. Between then and F-002, somebody added Claude-sidepanel chat (`MessagePane.tsx`'s `ClaudeChatMessage` types, `useWorkshopEvent("claude_ask_user_question")` handlers, `/api/claude/ask-user-question` UI), Anthropic secret UI, Codex/Anthropic onboarding tiles in `EmptyState`, and Claude-specific annotation source types. Most of it had no server backing (the corresponding `/api/claude/...` and `/api/models/anthropic` routes don't exist on the daemon — `src/server.ts` returns 404 for them).

**Closed 2026-09-23** — Kolya decided (verbatim): "удалить всю Claude Code UI и runtime-server-side bridge. Мы делаем наше решения для opencode, gigacode, mcode, hermes agent, vibe mistral, zcode." F-002 cleanup scope was executed in this commit. The full picture at start of commit:

- Server-side backend (`src/server.ts`) — **no Claude/Codex routes existed**. `/api/agent/...` is OpenCode-sidepanel (F-006), `/api/status` returns `{agent, agent_provider}`, `/api/agents` is the agents.json registry for local-replay. Nothing on the server matched Claude Code or Codex.
- Frontend type drift — `AnnotationSource = "user" | "claude-code" | "codex"`, `SecretKey = "anthropic" | "openai" | "raindrop" | "query"`, several `api/claude/...` fetch calls, `getAnthropicModels()` calling a non-existent endpoint, `useAnthropicModels()` hook.
- Onboarding — `EmptyState.tsx` listed Claude Code + Codex + Anthropic icon next to Cursor / Windsurf / Cline / Gemini CLI.

**Scope of removal in this commit:**

- `app/src/api/chat.ts` — removed `ClaudeAskUserQuestion`/`ClaudeAskQuestion`/`AgentLoadout`/`AgentStreamEvent`/`ClaudeMessageStream` types and `answerAskUserQuestion()` function. The endpoint `/api/claude/ask-user-question/:id/answer` was never implemented server-side — frontend was calling it in a void. Other OpenCode-sidepanel functions kept (`listAgentSessions`, `getAgentSession`, `getAgentLoadout`, `sendAgentMessage`).
- `app/src/api/agents.ts` — removed `claude_code` branch in `getAgentConnectionStatus()` (server never returned `claude_code`), removed `getAnthropicModels()` (calls non-existent `/api/models/anthropic`).
- `app/src/hooks/use-agents.ts` — removed `useAnthropicModels()` hook.
- `app/src/components/ConnectionIndicator.tsx` — removed `body.claude_code ??` branch.
- `app/src/components/AnnotationChip.tsx` — `SOURCE_GLYPH` "claude-code" / "codex" → "opencode", labels retargeted.
- `app/src/components/SpanTree.tsx` — annotation input type `"user" | "claude-code"` → `"user" | "opencode"`.
- `app/src/components/RunDetail.tsx` — narrowed `createAnnotationAndSave` source literal, removed `anthropicModels?: string[]` prop threading through `ViewHeader` / `EditReplayModal` / `buildReplayModelOptions`, removed `useEffect` that fetched `/api/models/anthropic`, removed `[anthropicModels, setAnthropicModels]` state.
- `app/src/pages/SavedPage.tsx` — `SavedAnnotationPreview.source` union narrowed.
- `app/src/pages/SettingsPage.tsx` — removed `anthropic` field from `KeysSection` (no server backing, field was 100% UI-only), removed `raindrop` field (F-001 cloud), removed `query` field (F-017 local search). `SecretKey` is now `"openai"`-only.
- `app/src/api/secrets.ts` — narrowed `SecretKey = "openai"`.
- `app/src/components/EmptyState.tsx` — dropped "Claude Code" and "Codex" from "Works with" tiles, removed `anthropicIcon` and `codexLogo` imports, removed 3 unused icon files (`app/src/assets/codex-logo.svg`, `app/src/assets/claude-code-logo.png`, `app/src/assets/agent-icons/anthropic.svg`).
- `app/src/i18n/locales/{en,ru}.json` — removed `anthropicPlaceholder`/`anthropicDescription`/`claudeCodeOnboarding`/`raindropPlaceholder`/`raindropDescription`/`raindropCloudMcp` keys (3 per locale). `queryPlaceholder`/`queryDescription`/`query` placeholder kept — these are used by `SearchPage.tsx` for the **search box**, not for a cloud API key (semantically mis-named key — renaming deferred to F-030).
- `src/parse.ts:228` — comment removed `@raindrop-ai/claude-agent-sdk` mention (now refers to generic AI SDK users).
- `src/db.ts:162` — comment "conversations with Claude" → "chat history".
- `src/agents.ts:85, 89` — comment renamed "Claude Agent SDK pattern" → "third-party sub-agent pattern".
- `src/index.ts` — 4 comments updated: `mcp` help text, Claude-Code reconnect comment, umbrella setup comment, status messaging.
- `scripts/install-local.ts:218` — comment "dev's real ~/.cursor / ~/.claude" → "~/.cursor / ~/.opencode".

**Out of scope (deferred to F-030 "Claude Code UI / MessagePane refactor"):**

- `app/src/components/MessagePane.tsx` — Claude-specific UI: `ClaudeChatMessage`/`ClaudeSessionSummary`/`ClaudeAskUserQuestion` local types (line 17-90), `useWorkshopEvent("claude_ask_user_question")` and `"claude_ask_user_question_resolved"` handlers (lines 487, 504), `/api/claude/ask-user-question/:id/answer` fetch (line 698), `claude-slash-menu` UI (lines 930, 989). All of these are dead (server has no corresponding routes), but cleaning them up requires either (a) deleting them and accepting that MessagePane loses the Claude Code chat sidepanel feature entirely, or (b) rewriting the `Claude*` types to `Agent*` (the actual runtime is OpenCode-sidepanel per F-006). Both require reading 2248 lines of `MessagePane.tsx` and making UX decisions (does the slash-menu for OpenCode replace Claude's?). Out of scope for F-002 cleanup; tracked as F-030.
- `app/src/utils/helpers.ts:80` — `if (s.includes("claude") || s.includes("anthropic")) return { label: "Anthropic" }` — this is **provider string detection** for displaying a model/provider label. Generic in nature (matches any model name with `claude` or `anthropic` substring), not Claude-specific integration. Kept. If user later runs OpenCode with Anthropic as a backend, this still labels correctly.
- `app/src/components/RunDetail.tsx:78-82` — `DEFAULT_REPLAY_MODEL_FALLBACKS = ["claude-sonnet-4-6", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]` — these are model names offered in the EditReplayModal dropdown. Removing them would force every replay to use only models present in the trace, breaking "fork with a different model" UX. Kept as legacy defaults.
- `app/src/components/EmptyState.tsx:43` — `Cline` entry (with URI `vscode://extension/saoudrizwan.claude-dev` — that's the Cline VSCode extension ID, **not Claude Code**). Kept.
- `src/spans/adapters/ai-sdk.ts:14` — comment mentioning `claude-agent-sdk` adapter as a comparator. Comment-only. Kept.
- `skills/{setup-agent-replay,instrument-agent}/SKILL.md` and `src/skills.compiled.ts` — reference `claude-agent-sdk` as an example third-party integration in framework listings. Out of scope (docs, not code); tracked separately as F-031.

**Kept (NOT Claude/Codex-specific):**

- ✅ `src/spans/adapters/ai-sdk.ts` — generic AI SDK adapter, used by OpenCode too.
- ✅ `src/spans/adapters/livekit.ts` — separate framework.
- ✅ `@ai-sdk/openai` dep — OpenCode also uses OpenAI-compatible providers.
- ✅ `src/agents.ts` (sub-agent detection) — generic, used by OpenCode too.
- ✅ `examples/ai-sdk-chat/` — generic AI SDK example, not Codex-specific.
- ✅ `app/src/utils/helpers.ts:80` — provider string detection, generic.

**Verification:**

- `bun x tsc --noEmit` → 0 errors.
- `bun test tests/` → 138 pass / 0 fail (no regressions).
- `bun scripts/embed-skills.ts` → regenerated `src/skills.compiled.ts` (still references claude-agent-sdk in docs strings, see F-031 note).
- `bun scripts/embed-migrations.ts --check` → up to date.
- Live UI smoke — deferred to Kolya per the "no daemon restart by the assistant" rule. Source-mode verification sufficient: no schema/migration change, no new endpoint, all removed code paths were no-ops (server returned 404 anyway).

**Cross-repo impact:** NONE. Pure `agenttrace/` change. Plugin (`agenttrace-opencode-plugin`) and bridge (`agenttrace-qwen-bridge`) repos don't depend on any Claude/Codex/Anthropic surface.

**Out-of-band follow-ups (not part of this commit):**

- F-030 — `MessagePane.tsx` Claude-specific UI refactor (delete or rewrite `Claude*` types and slash-menu).
- F-031 — Update `skills/*.md` docs to clarify OpenCode-only fork scope, removing examples that reference Claude Agent SDK as a first-class integration.
- F-NNN — Update umbrella `STATUS.md` and `agenttrace/AGENTS.md` if any user-facing messaging still mentions Claude Code.

**Todos:**

- [x] Plan F-002 scope (this entry, with explicit "kept" list).
- [x] `app/src/api/chat.ts` — remove `ClaudeAskUserQuestion`/`ClaudeAskQuestion`/`AgentLoadout`/`AgentStreamEvent`/`ClaudeMessageStream`/`answerAskUserQuestion`.
- [x] `app/src/api/agents.ts` — drop `claude_code` branch and `getAnthropicModels`.
- [x] `app/src/hooks/use-agents.ts` — drop `useAnthropicModels`.
- [x] `app/src/components/ConnectionIndicator.tsx` — drop `body.claude_code ??` branch.
- [x] `app/src/components/AnnotationChip.tsx` — narrow `SOURCE_GLYPH` to `"opencode"` / `"user"`.
- [x] `app/src/components/SpanTree.tsx` — narrow `onCreateAnnotation.source` literal.
- [x] `app/src/components/RunDetail.tsx` — drop `anthropicModels` prop threading, state, and `/api/models/anthropic` fetch.
- [x] `app/src/pages/SavedPage.tsx` — narrow `SavedAnnotationPreview.source`.
- [x] `app/src/pages/SettingsPage.tsx` — drop `anthropic`/`raindrop`/`query` fields, stale-comment removal.
- [x] `app/src/api/secrets.ts` — narrow `SecretKey = "openai"`.
- [x] `app/src/components/EmptyState.tsx` — drop "Claude Code" and "Codex" tiles.
- [x] `app/src/assets/{codex-logo.svg,claude-code-logo.png,agent-icons/anthropic.svg}` — `rm`.
- [x] `app/src/i18n/locales/{en,ru}.json` — drop 3 locale keys each (6 total).
- [x] `src/parse.ts`, `src/db.ts`, `src/agents.ts`, `src/index.ts`, `scripts/install-local.ts` — comment cleanup.
- [x] `bun x tsc --noEmit` + `bun test tests/` (138/138) + `embed-migrations` check.
- [ ] Live UI smoke (deferred to Kolya).
- [ ] Commit + push (awaits Kolya's word).

---

### F-030 — MessagePane.tsx Claude-shell UI removal (Option A — delete)

**Context:** F-002 cleanup (commit `5e1c44f`, 2026-09-23) stopped short of `app/src/components/MessagePane.tsx` (2248 lines) because the file mixes OpenCode-sidepanel runtime (F-006) with Claude-specific UI that has no server backing. Live UI smoke on 2026-09-23 confirmed **two sidepanel branches inside `MessagePane.tsx`** selected by some condition (likely `provider === "claude"`):

1. **OpenCode-shell** — works. Visible on most runs (Convo tab, OpenCode agent). Has header `< All Chats`, "New chat" title, workspace path with "Change" button, preset chips (e.g. "Что здесь сломалось?", "Какие инструменты Workshop мне доступны?"), chat input ("Спросить про этот ран...") with send button. Button in Run Detail: `>_ Ask OpenCode`. Backend wired via F-006 — `/api/agent/messages`, `/api/agent/sessions`, `/api/agent/loadout`, `/api/agent/provider` all work.

2. **Claude-shell** — dead. Renders on some runs (Convo tab for run `62253` observed live). Visible elements: header "Connect your coding agent", subtitle "Ask questions about traces and resume chats from your terminal", two badge buttons "Claude Code" (large, active) + "Codex" (small, inactive), single CTA button "Connect Claude Code", footer "Your Recent Claude Code Chats" + "No chats yet". After clicking Connect, transitions to: header "Claude Code", fake branch row "digital-architecture" with green dot, "New chat" button (dead — no input below it). **No `<input>` or `<textarea>` in DOM** — user cannot type anything. `Ask Claude Code` button in Run Detail does the same thing. **No server backing**: `src/server.ts` has zero `/api/claude/...` routes, `broadcast("claude_ask_user_question")` doesn't exist, `/api/claude/ask-user-question/:id/answer` returns 404.

**Decision (Kolya, 2026-09-23):** **Option (A) — delete Claude-shell entirely.** User verdict: "удалить всю Claude Code UI, и runtime-server-side bridge. Мы делаем наше решения для opencode, gigacode, mcode, hermes agent, vibe mistral, zcode." Option B (rewrite Claude-shell into OpenCode-shell) declined because Claude-shell never produced visible behavior anyway, and OpenCode-shell already exists in the same file.

**Dead-code parts identified in `MessagePane.tsx`:**

- Local type definitions (lines 17-90): `interface ClaudeChatMessage`, `interface ClaudeSessionSummary`, `interface ClaudeSessionDetail extends ClaudeSessionSummary`, `interface ClaudeAskUserQuestion`, `interface ClaudeAskQuestion`, `interface ClaudeMessageStream`, plus local copies `AgentStreamEvent` and `AgentLoadout` (MessagePane.tsx doesn't import from `api/chat.ts`).
- `useWorkshopEvent("claude_ask_user_question")` handler at line 487 — listens for events the server never broadcasts.
- `useWorkshopEvent("claude_ask_user_question_resolved")` handler at line 504 — same.
- `fetch("/api/claude/ask-user-question/:id/answer", { method: "POST", body: JSON.stringify({ answers }) })` at line 698 — endpoint doesn't exist server-side.
- `<div id="claude-slash-menu">` UI at lines 930 and 989 — DOM-rendered but driven by no live data.
- The provider-conditional branch (`if (provider === "claude") showClaudeShell else showOpenCodeShell`) — **the actual switching point**. Must be located and removed so the OpenCode-shell becomes the only path.

**Out of scope (kept for after this commit):**

- `app/src/utils/helpers.ts:80` — provider string detection (`if (s.includes("claude") || s.includes("anthropic")) return { label: "Anthropic" }`). Generic, not integration-specific. If user later runs OpenCode with Anthropic backend, still labels correctly.
- `app/src/components/RunDetail.tsx:79-81` — `DEFAULT_REPLAY_MODEL_FALLBACKS = ["claude-sonnet-4-6", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]`. EditReplayModal dropdown options, real user UX.
- `app/src/components/EmptyState.tsx:43` — `Cline` entry (claude-dev in URI is the Cline VSCode extension ID, not Claude Code).
- `src/spans/adapters/ai-sdk.ts:14` — comment-only mention.
- Local rename `Claude*` types → `Agent*` for consistency with `api/chat.ts`. This is a separate cleanup pass if desired; not required for Option A.
- `src/skills.compiled.ts` claude-agent-sdk mentions (docs, F-031).

**Work plan for next session:**

1. Read `app/src/components/MessagePane.tsx` end-to-end (2248 lines). Identify the exact provider-conditional branch that switches between Claude-shell and OpenCode-shell.
2. Grep for all `Claude*` references in the file to make sure no other places reference them outside the dead-code block.
3. Delete the dead-code block entirely (or replace the conditional with `if (true) showOpenCodeShell` if the surrounding structure is hard to untangle).
4. Rename local `Claude*` types to `Agent*` IF the rename is mechanical and doesn't tangle imports — otherwise leave for a follow-up.
5. Remove the `Ask Claude Code` button in RunDetail that triggers the Claude-shell path.
6. Verify: `bun x tsc --noEmit && bun test tests/` clean. Live UI smoke: Convo tab for both kinds of runs (the one that triggered Claude-shell, e.g. `62253`, and the one that triggers OpenCode-shell, e.g. `783f4c93`) should both render OpenCode-shell now.
7. Update F-030 to `Closed YYYY-MM-DD` and move to `## Closed Features`.

**Effort:** 4-6 hours. Trivial regression bar: tsc + bun test stay green.

**Cross-repo impact:** NONE. Pure `app/`-side change.

**Handoff:** see `ai-docs/specs/handoff/F-030-claude-shell-handoff.md` (to be written on next-session start — must include the exact conditional pattern in MessagePane.tsx, plus a screenshot of Claude-shell for reference, plus the OpenCode-shell reference screenshot so the visual baseline is captured).

**Todos:**
- [ ] Start next session: write handoff doc with screenshots from this session + grep evidence
- [ ] Locate provider-conditional in `MessagePane.tsx` that branches Claude vs OpenCode shell
- [ ] Grep all `Claude*` references in `MessagePane.tsx` to map the full dead-code region
- [ ] Decide: hard-delete vs `if (true) showOpenCodeShell` substitution
- [ ] Delete dead-code region + `Ask Claude Code` button in RunDetail
- [ ] (optional) rename remaining `Claude*` types to `Agent*`
- [ ] `bun x tsc --noEmit && bun test tests/` clean
- [ ] Live UI smoke on `62253` + `783f4c93` (and a few other runs in between to confirm no regressions)
- [ ] Update F-030 to Closed; move to `## Closed Features`

---

### F-031 — Update skills/ docs to clarify OpenCode-only fork scope

**Context:** `skills/setup-agent-replay/SKILL.md` and `skills/instrument-agent/SKILL.md` (both embedded into `src/skills.compiled.ts` by `scripts/embed-skills.ts`) reference `claude-agent-sdk` as an example third-party integration. After F-002, Claude Agent SDK is no longer a first-class supported integration in this fork. References should be removed or rewritten as "third-party / generic AI SDK" examples.

**Effort:** 1-2 hours (search-and-replace in two SKILL.md files, re-run `bun scripts/embed-skills.ts`).

**Cross-repo impact:** NONE. Skills are runtime content consumed by `/api/skills` and `/v1/skills` endpoints.

**Todos:**
- [ ] Grep `skills/*.md` for "claude-agent-sdk" / "Claude Agent SDK" / "@raindrop-ai/claude-agent-sdk"
- [ ] Replace with generic "third-party AI SDK" framing
- [ ] Re-run `bun scripts/embed-skills.ts`
- [ ] `bun x tsc --noEmit` clean

---

### F-032 — Complete UI localization (i18n sweep across all components)

**Context:** F-016 (commit `4b63371`, 2026-09-08) shipped i18n infrastructure (`react-i18next` + `i18next-browser-languagedetector` + `useT()` hook + LangSwitcher in NavSidebar + `app/src/i18n/locales/{en,ru}.json` with ~120 keys). But the **sweep** — replacing hardcoded strings across all components — was left as a future todo and **never completed**. Result, verified live on 2026-09-23:

- LangSwitcher correctly toggles `localStorage["workshop:lang"]` and the icon "ru"/"en" pill changes in NavSidebar footer (left of screen).
- **Preset prompts in TraceDebugPrompt** (top-right sidepanel) — localized. Visible in live smoke: "Что здесь сломалось?", "Какие инструменты Workshop мне доступны?".
- **Everything else** — hardcoded English. On the same screenshot:
  - Top-bar buttons: "Annotate", "Debug", "Download", "Save", "Replay", "Export as HTML" — all English.
  - Tab labels: "Overview", "Span Tree", "Session Tree", "Convo" — English.
  - Stat labels in CONVO STATS / BY MODEL / PER-RUN: "duration", "LLM calls", "tool calls", "sub-agent", "errors", "tokens", "BY MODEL", "PER-RUN", "covered", "Totals undercount spans" — all English.
  - Chat input placeholder: "Спросить про этот ран..." — **already Russian** (so this one works).
  - DCP compression labels: "DCP", "removed", "summary", "net", "compressions", "tokens removed", "tokens in summaries", "net context saved", "compressed", "Deltas parsed from DCP chat notifications — exact when captured." — **English**.
  - **Preset chip that gets sent to OpenCode** ("What went wrong here? Inspect the focused run and the failing spans, and tell me what to fix.") — **English**, even when UI is RU. Verified screenshot chat response from OpenCode was also English ("I'll inspect the focused run to find the failing spans.").

**Why this is a real bug, not cosmetic:**

1. **Promise gets sent to the agent in English** when LangSwitcher = ru. This is the worst symptom — the user's language choice for the UI does NOT propagate to the prompt template. Every OpenCode invocation from a Russian-speaking user carries an English prompt. This is observable in the screenshot: preset is in English, agent response is in English.

2. **Mixed-language UI** is harder to read than no-i18n at all. Russian-speaking users see Russian chat input + English stat columns + English preset chip + English button labels — confusing.

3. **F-016 explicitly deferred the work** in its own todos:
   ```
   - [ ] Future sweep: RunsPage, SearchPage, SettingsPage, error messages, button labels
   - [ ] Unit test: key switch under `I18nProvider language="ru"`
   ```
   These todos were never ticked. Plus the actual scope turned out larger than anticipated — every component is a candidate.

**Scope of work:**

**A. Surface the bug** (the prompt template problem) — separate, smaller fix:

- `app/src/components/presetPrompts.ts` exports `PRESET_PROMPTS` as `PresetPrompt[]` with English-only `prompt` strings. These get sent verbatim to OpenCode. Fix: ship a `presetPrompts.ru` namespace OR ship `PRESET_PROMPTS` as `Record<lang, PresetPrompt[]>` keyed by language, OR (best) keep English prompts but expose a language-aware variant: `PRESET_PROMPTS_BY_LANG[locale]` where Russian locale has Russian prompts. The screenshot shows Russian chat input works (placeholder), but the preset chip that gets injected is English.
- Wire `useT()` or `getLanguage()` into the preset chip rendering so the displayed text + the actually-sent prompt both follow the user's language.
- Acceptance: switching to Russian, clicking a preset chip — both the chip text AND the sent prompt are Russian.

**B. Full UI sweep** (larger fix):

For each component, replace hardcoded English strings with `t("namespace.key")` calls and add the corresponding key to `app/src/i18n/locales/{en,ru}.json`. Components to sweep (verified incomplete vs. data-rebuilt):

- `app/src/components/RunDetail.tsx` (1677 lines) — biggest offender. Tabs ("Overview/Span Tree/Session Tree/Convo"), top-bar buttons ("Annotate/Debug/Download/Save/Replay/Export as HTML"), stat column headers, error messages, save-folder dropdown labels, "MODEL"/"DURATION"/"USER"/"CONVO"/"TRACE" badges, DCP compression block ("DCP", "compressions", "removed", "summary", "net", "tokens removed", "tokens in summaries", "net context saved", "compressed", "messages", "msg", "Deltas parsed from DCP chat notifications"), save modal ("Cancel", "Move folder or unsave", "Saved", "Save run", "Save", "Folder"), error toasts ("Could not load run (${status})", "Failed to load run").
- `app/src/components/SpanTree.tsx` — "No spans", span type labels, "tool"/"subagent"/"llm" filter chips.
- `app/src/pages/RunsPage.tsx` — page title, filter labels.
- `app/src/pages/SavedPage.tsx` (1118 lines) — folder names, "Saved Events", sort headers.
- `app/src/pages/SearchPage.tsx` — already partially localized (F-016), but search box placeholder, results count, "no results", facet headers.
- `app/src/pages/SettingsPage.tsx` (352 lines) — section titles ("API Keys", "Models", etc.), description text, all input labels, "Saved"/"Saving..." status, error messages.
- `app/src/components/EmptyState.tsx` — "Waiting for your agent...", "Now just instrument your agent using our skill. Next run, you'll see traces here.", "See demo traces", "Loading demo traces...", "Traces will appear here as soon as your instrumented agent runs.", "Works with".
- `app/src/components/ConnectionIndicator.tsx` — status labels, workspace switcher.
- `app/src/components/AnnotationChip.tsx` — "issue"/"good"/"note" labels (currently in `KIND_STYLES`), "OpenCode"/"You" source labels.
- `app/src/components/ChatFlow.tsx`, `MessagePane.tsx` — message bubble labels, "Scroll to bottom", "Thinking...", assistant/user/tool/system role labels.
- `app/src/components/NavSidebar.tsx` — already partially localized (F-016).
- `app/src/components/LangSwitcher.tsx` — already partially localized.

**Out of scope:**

- `app/src/i18n/locales/*.json` keys for **new languages** beyond en/ru. Kolya asked for "полную локализацию" but didn't specify languages. Assume en + ru only for this Feature. Adding more languages is `F-033` (add language X).
- `src/skills.compiled.ts` English-only skill docs (F-031 covers Claude-related mentions, but full skill doc translation is separate).
- Daemon-side error messages (server returns English error JSONs, like `{"error":"run_id required"}`) — these are server-rendered or already localized server-side per F-016's contract; only UI strings need translation.
- Numbers / dates / measurement formatting (Workshop displays "44.1s", "81 452 in / 4 512 out", "26 spans", "85 964 tokens"). These follow locale-aware formatting in `i18next-browser-languagedetector` automatically (numbers + dates), but token counts ("85 964") may need explicit `<Intl.NumberFormat>` if we want comma vs. space separators. Not blocking for this Feature.

**Effort:**

- Surface-bug (preset prompt localization): 1-2 hours.
- Full sweep: 1-2 days of mechanical work (grep-and-replace per file). Each file needs:
  1. Read all hardcoded English strings.
  2. Decide on a key namespace (already established: `nav.*`, `runs.*`, `search.*`, `saved.*`, `settings.*`, `run.*`, `convo.*`, `annotations.*`, `spans.*`, `errors.*`, `chat.preset.*`).
  3. Add keys to both `en.json` and `ru.json`.
  4. Replace literals with `t("namespace.key")`.
  5. Verify tsc + tests.

**Acceptance criteria:**

- [ ] LangSwitcher toggle (RU en) re-renders the entire UI in the chosen language.
- [ ] All visible user-facing English text in RunsPage, RunDetail (all 4 tabs), SearchPage, SavedPage, SettingsPage, EmptyState, ConnectionIndicator, AnnotationChip, ChatFlow, MessagePane is localized.
- [ ] Switching to RU, clicking a preset chip in TraceDebugPrompt — the chip label AND the prompt sent to OpenCode are both Russian.
- [ ] `bun x tsc --noEmit` clean.
- [ ] `bun test tests/` clean.
- [ ] No regression: OpenCode traces still stream, sidepanel still works, settings still persist.
- [ ] Live UI smoke: switch to RU, navigate RunsPage → RunDetail → Convo, verify all UI text is Russian, verify preset chip sends Russian prompt, verify OpenCode responds in Russian (or at least attempts to).
- [ ] Update F-032 to `Closed YYYY-MM-DD`; move to `## Closed Features`.

**Handoff for next session:**

- Take a fresh live-UI smoke in both EN and RU, screenshot every screen (Runs, RunDetail×4 tabs, Search, Saved, Settings, EmptyState when no traces). Use as the i18n source-of-truth.
- Build the key catalog from those screenshots — don't trust the existing `en.json` to enumerate what's visible.
- Sweep in priority order: top-bar buttons + tab labels + stat headers (RunDetail) → preset prompts (the bug) → page titles → settings labels → error messages.

**Cross-repo impact:** NONE. Pure `app/`-side change. No wire-format change.

**Todos:**
- [ ] Start next session: take EN+RU screenshots of all main screens for key catalog
- [ ] (Block A — surface bug) Fix `presetPrompts.ts` so chip text + sent prompt follow `useT()`
- [ ] (Block B — sweep) Add new keys to `en.json` + `ru.json` covering all observed English literals
- [ ] (Block B — sweep) Replace literals in RunDetail, SpanTree, RunsPage, SavedPage, SearchPage, SettingsPage, EmptyState, ConnectionIndicator, AnnotationChip, ChatFlow, MessagePane
- [ ] Verify tsc + tests + live UI smoke in both languages
- [ ] Update F-032 to Closed; move to `## Closed Features`

---

### F-033 — Run-detail Issue annotation banner: collapse by default + expand on click

**Context:** Issue annotations surface as a red-bordered banner at the top of RunDetail (`! Issue · {source} · {time ago}` + description body). Live UI smoke at 2026-09-23 (screenshot a0022cd383ee/screenshot-1791406562306.png, run `6225316c`, annotation from OpenCode agent via MCP hook) revealed the banner is rendered **fully expanded** with no collapse affordance:

```
! Issue · OpenCode · 12m ago
─────────────────────────────────
No failures — status OK, 3/3 tool calls succeeded. But this run's
only input was a context-pruning notice ("2 messages compressed,
topic: Open Work agent intro"); the 471-char summary body never
reached the model. It re-ran agent introspection from scratch
(~22k prompt tokens, 16s) and returned a near-duplicate of the
previous turn's answer. Also duplicated: a twin run from
agenttrace-opencode-plugin 0.0.2 exists with the same message_id.
```

This pushes the rest of RunDetail (Tabs, Stats, Span Tree) far down the page even when the annotation is short. Multi-paragraph OpenCode self-diagnostics will push it even further. No "Show less" / dismiss control in the current rendering.

**Acceptance criteria:**

- [ ] Banner is **collapsed by default** showing only the title (`! Issue · OpenCode · 12m ago`). Body hidden until user clicks "Show more" / expands.
- [ ] Expand action is keyboard-accessible (Enter/Space when focused).
- [ ] Long annotations (>200 chars) auto-truncate with "..." and a "Show full annotation" button.
- [ ] No regression: short annotations (<200 chars) still fully visible after collapse fix (don't make user click for tiny body).
- [ ] `bun x tsc --noEmit && bun test tests/` clean.
- [ ] Live UI smoke: open run `6225316c`, verify banner collapsed by default; click "Show more" → full body visible; click "Show less" → back to title-only.
- [ ] Update F-033 to Closed; move to `## Closed Features`.

**Files to look at:**

- `app/src/components/RunDetail.tsx` — locate the banner render (likely `AnnotationChip` usage with severity styling, or a separate Issue banner block).
- `app/src/components/AnnotationChip.tsx` — might already support expandable; if so, the banner just needs to default to collapsed.

**Effort:** 1-2 hours.

**Cross-repo impact:** NONE. Pure `app/`-side change.

**Todos:**

- [ ] Locate banner render site
- [ ] Add collapse state (default collapsed for body > 0 chars)
- [ ] Add "Show more" / "Show less" buttons
- [ ] Add keyboard accessibility
- [ ] Verify tsc + tests + live UI smoke

---

### F-034 — Same `message_id` registered as two separate runs (twin runs bug)

**Context:** Same screenshot as F-033 shows a real upstream bug surfaced by an agent self-diagnostic:

> "Also duplicated: a twin run from `agenttrace-opencode-plugin 0.0.2` exists with the same `message_id`."

This means the **same `message_id`** (an OpenCode-side identifier for an agent message) was ingested twice by Workshop and stored as **two distinct run rows**. Possible causes:

1. **Plugin bug** — `agenttrace-opencode-plugin` emits `track_partial` event twice for the same `message_id`. Two source agents (the plugin and `agenttrace-opencode-plugin 0.0.2` mentioned in the agent's text suggest there are **two plugin versions** both running on the same OpenCode installation, or the plugin self-resends the event).
2. **Daemon bug** — `src/server.ts` ingest handler at `POST /v1/events/track_partial` doesn't dedupe by `message_id` before calling `upsertEventSpan` / `insertSpan`. Two different runs each get a partial of the same message, both persist as new runs instead of adopting the existing one.
3. **Race** — Plugin sends event twice within milliseconds (network retry, idempotency key collision), daemon doesn't dedupe.

The `adoptRunByEventId` helper (F-028 closed) was added to handle the case where an existing run gets re-attached by event_id, but it's for `event_id`, not `message_id`. Need to verify if `message_id` is propagated through the wire format (`track_partial` body shape) and whether dedupe keys exist for it.

**Reproduction:**

- Run an OpenCode session that triggers DCP compression mid-stream (the agent's diagnostic is specifically about this scenario).
- Observe Workshop DB: `SELECT id, event_id, message_id, created_at FROM runs ORDER BY created_at DESC LIMIT 5;` — if two rows have the same `message_id`, this bug is live.
- Test data: Kolya's screenshot shows run `6225316c` with a duplicate.

**Acceptance criteria:**

- [ ] Reproduce bug locally: trigger same scenario, confirm two rows in DB with identical `message_id`.
- [ ] Identify root cause: plugin emits twice, daemon doesn't dedupe, or both.
- [ ] Fix in whichever layer: plugin-side check before emit, OR daemon-side dedupe by `message_id` before `insertRun`/`upsertEventSpan`.
- [ ] Add regression test: simulate two identical `track_partial` posts within 100ms; assert only one run row exists after.
- [ ] `bun x tsc --noEmit && bun test tests/` clean.
- [ ] Live UI smoke: re-run the OpenCode scenario, confirm only one run row, single Run Detail page (no twin).
- [ ] Update F-034 to Closed; move to `## Closed Features`.

**Files to look at:**

- `agenttrace-opencode-plugin/` — check `EventShipper.emitHelper()` / `track_partial` payload construction; verify `message_id` is stable across emits for the same event.
- `agenttrace/src/server.ts` — `POST /v1/events/track_partial` handler (~line 774). Look for any dedupe key, especially around `message_id`.
- `agenttrace/src/db.ts` — `insertSpan`, `upsertEventSpan`, `findRunByEventId`. May need a `findRunByMessageId` + dedupe pattern.

**Effort:** 2-4 hours (depending on whether root cause is plugin or daemon).

**Cross-repo impact:** likely fixes in **both** `agenttrace-opencode-plugin` and `agenttrace`. Need separate commits per repo, with plugin landing first per the cross-repo coordination rule (workshop UI change depends on plugin emitting deduplicated events).

**Todos:**

- [ ] Reproduce: same OpenCode scenario, observe twin runs in DB
- [ ] Identify root cause (plugin / daemon / both)
- [ ] Fix at the appropriate layer (plugin emits once, OR daemon dedupes)
- [ ] Add regression test
- [ ] Verify tsc + tests + live smoke
- [ ] Cross-repo coordination: plugin fix lands first, daemon second

---

### F-035 — Use `event_name` (not new `providerId` field) to distinguish qwen / gigacode / mcode / hermes / mistral / zcode / opencode

**Context:** Live UI smoke at 2026-09-23 (screenshot a0022cd383ee/screenshot-1791406800075.png, screenshot-1791407418376.png) revealed:

1. TRAJECTORY shows `claude_code_session` as a span name (legacy data — no live source emits this).
2. **The RunsPage left-sidebar already has an `All agents` dropdown** populated from the existing `event_name` values in the DB. Kolya's screenshot shows it listing: `code-agent`, `diagram-agent`, `f011-test`, `f014-test`, `kolya-dashboard`, `opencode_session`, `test-project`. **The discriminator already exists and already works** — Workshop UI already filters runs by `event_name`.

Kolya's correction (verbatim): "/steer это не хардкор, у нас в env параметрах можно задавать имена и в выпадающем списке они есть".

So this Feature is **dramatically smaller than originally scoped**. The `event_name` field in the wire format already does everything Kolya asked for. The plugin just needs to send **different `event_name` strings** for different agents, and the UI dropdown picks them up automatically. **No new wire format field, no schema migration, no new UI code, no i18n keys.**

**The original (superseded) F-035 plan** — adding a `providerId` field, schema migration, new UI badge, new i18n keys — was over-engineered. Replaced by this simpler approach below.

**Goal:** plugin stamps **per-agent `event_name`** based on `WORKSHOP_EVENT_NAME` env var (or `raindrop.json:eventName` config). For Kolya's stack:

- `WORKSHOP_EVENT_NAME=qwen_code_session` → plugin stamps `event_name: "qwen_code_session"`
- `WORKSHOP_EVENT_NAME=gigacode_session` → plugin stamps `event_name: "gigacode_session"`
- `WORKSHOP_EVENT_NAME=mcode_session` → plugin stamps `event_name: "mcode_session"`
- `WORKSHOP_EVENT_NAME=hermes_session` → plugin stamps `event_name: "hermes_session"`
- `WORKSHOP_EVENT_NAME=mistral_session` → plugin stamps `event_name: "mistral_session"`
- `WORKSHOP_EVENT_NAME=zcode_session` → plugin stamps `event_name: "zcode_session"`
- Default (no env var, no config): `event_name: "opencode_session"` (preserves existing behaviour).

**No daemon-side changes.** No schema migration. No new UI code. No i18n keys. The existing `/api/runs?agent=<event_name>` filter and the existing `All agents` dropdown in `RunsPage.tsx` automatically pick up the new values.

**Scope across repos:**

1. **`agenttrace-opencode-plugin/`** — change default `event_name` from `"opencode_session"` to read from:
   - Env var `WORKSHOP_EVENT_NAME` (highest priority).
   - `raindrop.json:eventName` config (fallback).
   - Default `"opencode_session"` (preserves existing).
   - Three-site lockstep: `dist/index.js`, `dist/index.cjs`, `~/.config/opencode/plugins/opencode-workshop-plugin.js`.
   - Bump version `0.1.0 → 0.1.1`.
   - Document in SKILL.md.

2. **`agenttrace-qwen-bridge/`** — JSON-stream bridge. Qwen bridge already produces events; it should:
   - Default to `event_name: "qwen_code_session"` instead of any hardcoded `"opencode_session"`.
   - Or read env var `BRIDGE_EVENT_NAME` for full flexibility.
   - Update wire-contract spec `ai-docs/specs/F-025-wire-contract.md`.

3. **`agenttrace-gigacode-bridge/`** (future repo, when built):
   - Default to `event_name: "gigacode_session"`.

4. **`mcode`, `hermes`, `mistral`, `zcode` bridges** (not yet built):
   - Each defaults to `event_name: "<agent>_session"` when constructed.

5. **No daemon changes.** No UI changes. No schema migration.

**Acceptance criteria:**

- [ ] Plugin reads `WORKSHOP_EVENT_NAME` env var first, then `raindrop.json:eventName`, then defaults to `"opencode_session"`.
- [ ] When `WORKSHOP_EVENT_NAME=qwen_code_session`, every `track_partial` payload from the plugin carries `event_name: "qwen_code_session"`.
- [ ] Workshop UI `All agents` dropdown shows the new `event_name` value automatically (verified by running a Qwen trace and refreshing the page).
- [ ] Filtering the RunsPage by the new event_name shows only runs from that agent.
- [ ] Existing OpenCode traces (`event_name="opencode_session"`) still filter correctly — backward compatibility preserved.
- [ ] Plugin version bumped to `0.1.1`, three-site lockstep updated.
- [ ] `bun x tsc --noEmit && bun test tests/` clean in daemon (no changes expected, but verify).
- [ ] Live smoke: set `WORKSHOP_EVENT_NAME=qwen_code_session`, run a Qwen trace, see it appear in `All agents` dropdown as a new option, filter by it.

**Effort:** 1-2 hours (plugin change is small: read env var, fall through to config, fall through to default). No daemon work.

**Out of scope:**

- **Removing legacy `claude_code_session` span name** from old DB rows (separate migration if Kolya wants).
- **Visual provider indicator** in RunDetail header — currently no badge, but the `All agents` dropdown filter is sufficient.
- **The mcode / hermes / mistral / zcode bridges themselves** (separate F-NNN when those are built).
- **No daemon changes** — the discriminator `event_name` already works end-to-end.

**Cross-repo impact:** plugin only (the other repos already produce `event_name` correctly via their own conventions — just need to make sure they default to the right value for their agent).

**Reference screenshots from 2026-09-23:**

- `a0022cd383ee/screenshot-1791406800075.png` — original `claude_code_session` discovery.
- `a0022cd383ee/screenshot-1791407418376.png` — Kolya's correction showing existing `All agents` dropdown with `code-agent`, `diagram-agent`, `f011-test`, etc.

**Todos:**

- [ ] Plugin: add `WORKSHOP_EVENT_NAME` env var + `raindrop.json:eventName` config read; thread through `EventShipper2`
- [ ] Plugin: 3-site lockstep (dist/{js,cjs} + static copy)
- [ ] Plugin: bump version `0.1.0 → 0.1.1`
- [ ] Plugin: document in bundled SKILL.md (or README) — `WORKSHOP_EVENT_NAME=qwen_code_session` for Qwen, etc.
- [ ] Qwen bridge: stamp `event_name: "qwen_code_session"` by default
- [ ] Live smoke: run OpenCode trace (default behaviour unchanged) + Qwen trace (via env var) + verify both appear in dropdown
- [ ] Update F-035 to Closed; move to `## Closed Features`

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

### F-027 — OTLP token-naming expansion (gen_ai.usage.prompt_tokens / completion_tokens) — Closed 2026-09-18

**Context:** upstream `v0.1.17` (`10f2161`) added two more `first(...)` aliases for AI-token attributes in `src/parse.ts:parseOtlpRequest`:

- `gen_ai.usage.prompt_tokens` (in addition to existing `ai.usage.inputTokens`, `ai.usage.promptTokens`, `ai.usage.prompt_tokens`, `gen_ai.usage.input_tokens`)
- `gen_ai.usage.completion_tokens` (in addition to existing `ai.usage.outputTokens`, `ai.usage.completionTokens`, `ai.usage.completion_tokens`, `gen_ai.usage.output_tokens`)

Some GenAI instrumentation libraries use the bare `prompt_tokens` / `completion_tokens` form (Google ADK, parts of OpenLLMetry, etc.). Without these aliases their token counts silently land as `0` in our span tables and break cost calculations / stats panels downstream.

**Result:** parser now accepts the bare-form aliases. Token counts from Google-ADK-style instrumentation now reach the runs table instead of silently defaulting to `0`.

**What shipped:**

- `src/parse.ts:210-211` — `first(...)` chain for `inputTokens` / `outputTokens` extended with `gen_ai.usage.prompt_tokens` and `gen_ai.usage.completion_tokens` (appended LAST, so legacy `_input_tokens` / `_output_tokens` precedence is unchanged for SDKs already using the long form).
- `tests/parse.test.ts` — new file, 3 tests:
  - acceptance: `gen_ai.usage.prompt_tokens=42` / `completion_tokens=17` → `input_tokens: 42` / `output_tokens: 17`
  - legacy `gen_ai.usage.input_tokens` / `output_tokens` still resolve (regression guard)
  - legacy attribute wins when both legacy and new alias are present on the same span (precedence guard — matches upstream `first(...)` ordering)

**Verified (2026-09-18):**

- `./node_modules/.bin/tsc --noEmit` → 0 errors
- `bun test tests/parse.test.ts` → 3 pass / 0 fail
- `bun test tests/` → 111 pass / 0 fail (no regressions across the suite)
- `./node_modules/.bin/eslint src/parse.ts tests/parse.test.ts` → 0 warnings

**Out of scope (re-affirmed):** any UI changes — this is purely a parser widening; downstream consumers (`StatsPanel`, cost calc, FTS facet) read the `input_tokens` / `output_tokens` columns already populated by the parser.

---

*Maintained by Miko (Hermes Agent) under Kolya's direction. Update in the same commit as the code change.*

### F-026 — Hardening security pass (CSP + allow-list for container/host.docker.internal access) — Closed 2026-09-18

**Context:** Upstream `raindrop-ai/workshop` v0.1.16 (`d46bcef`) and v0.1.17 (`10f2161`) shipped two complementary hardening changes — CSP/X-Frame-Options clickjacking protection and an opt-in `RAINDROP_WORKSHOP_ALLOWED_HOSTS` env-var that lets Docker bridge / `host.docker.internal` / local VMs reach the daemon. Both landed in our fork via F-026.

**Result:** Source-level changes landed; the running compiled binary on `:5899` will only reflect them after Kolya rebuilds + restarts.

**What shipped:**

- `src/local-access.ts` — added three helpers (verbatim from upstream):
  - `isPrivateRemoteAddress(address)` — true for loopback plus RFC1918 (10/8, 172.16/12, 192.168/16), IPv4 link-local (169.254/16), IPv6 unique-local (fc00::/7), and IPv6 link-local (fe80::/10). IPv4-mapped IPv6 (`::ffff:172.17.0.1`) is handled.
  - `parseAllowedHostsEnv(value)` — comma-separated env-var parser; tolerates `host:port` and full-URL entries (URLs are reduced to the hostname via `new URL(...).hostname`); lowercases entries; drops unparseable URLs (so a typo can't leave the allowlist non-empty and silently flip on private-network access).
  - `hostnameOnly(host)` — strips `[brackets]:port` from IPv6 Host headers and `host:port` from IPv4 Host headers, but does NOT split bare IPv6 addresses (which contain multiple colons).
- `src/server.ts` — wired the gate in three places (all in `createServer`):
  1. New middleware right after `http.createServer(app)` sets `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY` on every response (HTML, API JSON, WS upgrade — Express runs this middleware before any route or other middleware).
  2. `parseAllowedHostsEnv(process.env.RAINDROP_WORKSHOP_ALLOWED_HOSTS)` produces an `allowedHosts: Set<string>`; `isAllowedRemoteAddress` switches between `isPrivateRemoteAddress` (when allow-list non-empty) and `isLoopbackRemoteAddress` (default loopback-only). The WebSocket `verifyClient` and the socket-layer `app.use((req, res, next) => isAllowedRemoteAddress(...))` both consult this.
  3. `isAllowedLocalAccess` / `allowedIngestCorsOrigin` now accept the `allowedHosts` set; both the ingest-path CORS middleware and the cross-origin middleware pass it through. The helper `isAllowedLocalHostname` was generalized to also match `allowedHosts` entries (case-insensitive on lookup via `.toLowerCase()`).
- `src/index.ts` — ENVIRONMENT docblock updated to document `RAINDROP_WORKSHOP_BIND_HOST` (already supported in code, never documented) and the new `RAINDROP_WORKSHOP_ALLOWED_HOSTS` with the recommended `host.docker.internal` example.
- `tests/local-access.test.ts` — new file, 23 tests covering all 4 helpers: loopback narrowness (rejects RFC1918 by default), private-range coverage (IPv4 + IPv4-mapped + IPv6 ULA + link-local boundary cases), allow-list parsing (empty / bare / `host:port` / full-URL / mixed / case-insensitive lookup via lowercase normalization), and hostname parsing (bare IPv4, IPv4:port, bracketed IPv6:port, bare unbracketed IPv6).

**Verified (2026-09-18):**

- `./node_modules/.bin/tsc --noEmit` → 0 errors
- `bun test tests/local-access.test.ts` → 23 pass / 0 fail
- `bun test tests/` → 134 pass / 0 fail (was 111 before; +23 from new file)
- `bun run lint` → same 16 pre-existing errors as `main` (`bin/raindrop.js` `require/process/__dirname` undefs, `app/src/hooks/use-agents.ts` exhaustive-deps warning) — **0 new errors from F-026**
- Source-mode smoke (sandbox daemon on a free port, not the live `:5899`):
  - `GET /` and `GET /health` both return `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`
  - With `RAINDROP_WORKSHOP_ALLOWED_HOSTS=""` (default): `Host: 127.0.0.1` → 200; `Host: foo.local` → 403
  - With `RAINDROP_WORKSHOP_ALLOWED_HOSTS=foo.local`: `Host: foo.local` → 200; `Host: bar.local` → 403
  - With `RAINDROP_WORKSHOP_ALLOWED_HOSTS=host.docker.internal:5899`: `Host: host.docker.internal:5899` → 200 (port stripped from allow-list entry)

**Live-daemon smoke deferred to Kolya** — per the hard rule "no daemon restart by the assistant", `curl -i http://127.0.0.1:5899/` against the currently-running compiled binary will still lack the new headers until Kolya rebuilds (`bun run build:bun:stage`) and restarts (`raindrop workshop restart` or via tmux `workshop-fork` session). Source-level wiring is verified; the live binary is the only thing left.

**Out of scope (re-affirmed):** Cloud (`src/cloud/*`) — we already removed it in F-001. UI changes — none needed; the headers are sent before any route runs.


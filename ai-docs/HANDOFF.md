# HANDOFF snapshot — opencode-workshop fork, session 2026-07-21

> **For:** Next-session Miko (or any agent picking up this repo).
> **Read alongside:** [`PLAN.md`](PLAN.md) (live features + todos), [`AGENTS.md`](AGENTS.md) (conventions), root [`../AGENTS.md`](../AGENTS.md) (upstream build guide).
> **Mirror in Hindsight:** `mcp_hindsight_recall(query="handoff opencode-workshop 2026-07-21", budget="mid")` — backup.

## TL;DR

F-003 is now **functionally closed** on both sides of the contract: the workshop fork has Pattern-3 detection + subagent_name precedence in `src/agents.ts` (with a 9-test unit suite in `tests/agents.test.ts`), and the plugin fork attaches `subagent_name` to the `task` tool span in `tool.execute.before` (v0.1.0-kolya.7). Only F-002 remains as a planning-only Active Feature; everything else is closed. The repo is on `main`, working tree clean apart from the F-003 changes staged for the next commit.

- **HEAD:** `1788319` on `main` (in sync with `origin/main`)
- **Last 5 commits** (newest first):
  - `1788319` feat: sub-agent drill-down and timeline bands  *(F-003 extension, 12 files +489/-35)*
  - `bfa354c` docs: update F-004 and F-005 status to COMPLETE in HANDOFF.md and PLAN.md
  - `18392b9` docs: mark F-004 complete in PLAN.md and HANDOFF.md
  - `f7024ae` feat: Flat/Nested view-mode toggle with localStorage persistence + Session tree tab  *(F-004 P4+P5)*
  - `7ad4b30` feat: tabbed SpanDetail with role-specific message palette  *(F-004 P3)*

## What's done (committed)

### F-003 — Sub-agent visualization (`openspec/changes/add-subagent-visualization-f003/` + `openspec/changes/extend-subagent-drilldown-f003/`)

**Status:** Base + extension + plugin-side metadata + Pattern-3 detection **all shipped**. F-003 is functionally complete; only the sidebar add (scoped out by base proposal) and a real-session smoke test are deferred.

**Base** (commit `7f14f7e`): `detectSubAgents` consolidated to `src/agents.ts`; `SubAgent.subagent_name?` added; SpanTree gold `SUB_AGENT_ROOT` badge + friendly labels; in-tree `SubAgentBlock` section; FlameTimeline tooltip gold badge.

**Extension** (commit `1788319`, 12 files +489/-35): Multi-level drill-down in `RunDetail.tsx` via `focusStack` + breadcrumb chain (Run › A › B); nested sub-agents visible inside the focused agent view (`childAgents` → ChatFlow blocks + scoped "Session Tree" tab); `SpanTree.tsx` in-tree `SubAgentBlock` dive-in via optional `onDiveIn` prop; `FlameTimeline.tsx` gold bars + gold row labels for sub-agent roots + translucent gold time bands + click root bar → dive; `ChatFlow.tsx` forwards `subAgents` + `onDiveIn` to `FlameTimeline`.

**Closing patch (2026-07-22, uncommitted at handoff time)**:
- `src/agents.ts`: added Pattern 3 (bare `task` tool is recognised as a sub-agent root even before the LLM child is born). Also reads `subagent_name` from the tool span's own attributes (plugin attaches it there in `tool.execute.before`) and prefers `subagent_name` over `span.name` for `SubAgent.name`.
- `scripts/seed-traces.ts`: renamed `raindrop.subagent.name` → `subagent_name` to match the contract (was a latent bug — workshop UI never saw the label because the attribute key was wrong).
- `tests/agents.test.ts`: new file, 9 tests pinning Pattern 1/2/3 + attribute contract + precedence + JSON tolerance.
- `ai-docs/PLAN.md`: F-003 todos updated (sidebar item + real-session smoke remain as deferred).

**Companion plugin** (separate repo `~/workspase/projects/agenttrace-opencode-plugin`, v0.1.0-kolya.7): added `extractTaskLabel(args)` helper + conditional `attrString("subagent_name", taskLabel)` in the `task` branch of `tool.execute.before` for both `dist/index.js` and `dist/index.cjs`. Syntax-check passes (`node --check` both bundles). The label is derived from `args.description` (preferred, up to 120 chars) or `args.prompt` (first 60 chars).

**Fixture repair finding (important for future testing):** the base F-003 e2e test (`workshop-actions.spec.ts` L213) was RED before the extension work — `scripts/seed-traces.ts` fixture 3's `subagent.review` span lacked `ai.toolCall.name`, so `inferSpanType` typed it INTERNAL and `detectSubAgents` never fired. Repaired by adding `ai.toolCall.name` to the root + reparenting `read_file` under the LLM child + adding a new nested `subagent.lint` sub-agent. Base F-003 e2e now green; new drill-down + timeline e2e tests added (2 tests).

### F-005 — HTML session export (`openspec/changes/add-html-session-export-f005/`) — Closed

3 commits (`6af1a45` helpers + tests, `7fd068b` adapter + endpoint, `e69a50f` UI button). Pure rendering logic ported from `hermes-webui/api/session_export_html.py`. `src/export/html-export.ts` + `src/export/run-to-export-shape.ts` + `app/src/components/ExportButton.tsx`. Endpoint `GET /api/runs/:id/export`. 32 tests pass. Plugin-repo impact: NONE.

### F-004 — Phoenix-style spans UI (`openspec/changes/improve-spans-ui-phoenix-style-f004/`) — Closed

5 commits implementing Phoenix-style span tree visualization:
- **P1+P2** (`d63bf9a`): Unified span color palette (`span-colors.ts`) with CHAIN/RETRIEVER/EMBEDDING types + nested tree rendering with chevrons, expand/collapse, child-count badges.
- **P3** (`7ad4b30`): Tabbed SpanDetail with Messages/Metadata tabs + role-specific message palette (system navy, user gray, assistant orange, tool neutral).
- **P4+P5** (`f7024ae`): Flat/Nested view-mode toggle with localStorage persistence + Session Tree tab for sub-agent hierarchy visualization.

### F-001 — Remove all Cloud Raindrop integration — Closed

5 commits removed `src/cloud/` (12 files, -2397 lines), `src/auth/` (5 files, -847 lines), cloud references from `install.sh` + `README.md`, dropped `@raindrop-ai/ai-sdk` dep, swept stragglers. `source: "local" | "cloud" | null` retained in `src/db.ts` + `src/server.ts` for historical traces.

## Verification status (after `1788319`)

- `bun x tsc --noEmit` → CLEAN
- `bun run lint` → 0 errors / 3 PRE-EXISTING warnings (`MessagePane` springCloseFromResize, `RunDetail` annotationsApi, `use-agents` — all react-hooks-deps, none from this work)
- `bun run build` → 2.94s, success (chunk-size warnings pre-existing)
- `cd app && bun x playwright test workshop-actions.spec.ts` → **9/9 pass in 13.6s** (6 pre-existing + base F-003 gold-badge + 2 new extension tests)

## Resume checklist (next session)

1. **Real-session smoke for F-003 extension** — start daemon (`bun run dev`), run an OpenCode session that uses the `task` tool with nested sub-agents, verify the drill-down + breadcrumb + timeline bands behave on real spans (not just fixture data). Needs Kolya's OK before touching daemon. Corresponds to `openspec/changes/extend-subagent-drilldown-f003/tasks.md` 5.5.
2. **F-003 plugin-side metadata** — patch `opencode-workshop-plugin` (separate repo `~/workspase/projects/agenttrace-opencode-plugin/`) to capture `task` tool's `description` arg into `metadata.subagent_name` so the UI shows real names instead of fallbacks (`subagent.review`, `task N`).
3. **F-002** — replace Codex/Claude/Anthropic integrations with OpenCode equivalents. Planning done (see PLAN.md), code untouched. Will require careful grep + dependency audit.
4. **Archive completed OpenSpec changes** when Kolya signs off: `extend-subagent-drilldown-f003` is implemented but not yet archived per OpenSpec convention (archive happens after final approval).
5. **Run `graphify update .`** after any code change to refresh the knowledge graph.

## Known gotchas

- **`src/agents.ts` is the canonical SubAgent shape**; `app/src/utils/types.ts` mirrors it. When extending, keep both in sync.
- **`detectSubAgents` reads `subagent_name` from the LLM CHILD's attributes blob** (not from `raindrop.subagent.name` on the root TOOL_CALL). If you change the contract, update both sides + seed fixtures.
- **`src/server.ts` is Express-style** (`app.get("/api/runs/:id/export")`), not Hono.
- **Playwright e2e server** is spawned per-worker by `app/tests-e2e/fixtures.ts` (no `webServer` in `playwright.config.ts`); it serves `app/dist/` directly, so **rebuild with `bun run build` before re-running e2e** after any UI change.
- **Pre-existing app-side tsc issues** (`lucide-react`/`react-router-dom` React-19 JSX incompat, `SavedPage.tsx:1094` missing `Run` import) — root `bun x tsc --noEmit` won't surface them. Use `cd app && bun x tsc --noEmit` to see them. Do not fix unless explicitly asked.

## Reference files (read in this order if fresh)

1. Root `AGENTS.md` — upstream build/dev guide, user-vs-developer fork.
2. `ai-docs/AGENTS.md` — Kolya's fork conventions, Miko rules.
3. `ai-docs/PLAN.md` — live plan + todos (single source of truth per AGENTS.md).
4. This file — what's done, what's open.
5. `openspec/changes/extend-subagent-drilldown-f003/{proposal.md, design.md, tasks.md, specs/}` — F-003 extension canonical spec.
6. `openspec/changes/add-subagent-visualization-f003/` — F-003 base spec.
7. `openspec/changes/improve-spans-ui-phoenix-style-f004/` — F-004 spec.
8. `openspec/changes/add-html-session-export-f005/` — F-005 spec.
9. `graphify-out/GRAPH_REPORT.md` — codebase knowledge graph (run `graphify update .` after code changes).
10. `ai-docs/ARCHITECTURE.md` + `ai-docs/DEVELOPMENT.md` — system architecture + dev commands.

---

*Maintained by Miko (Sisyphus / GLM 5.2 orchestrator). Updated 2026-07-21 (post-F-003-extension ship).*
*Previous snapshot: 2026-07-21 04:25 MSK (pre-F-004-close, replaced).*

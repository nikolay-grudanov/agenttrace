# HANDOFF-NEXT-SESSION — Tier 1 roadmap picks up here

> **For:** Next-session Miko (or any agent picking up Tier 1 work).
> **Generated:** 2026-09-04 by the session that closed F-005/F-012/F-013 and pushed everything.
> **Read first:** `ai-docs/PLAN.md` (live features + roadmap), `ai-docs/AGENTS.md` (conventions).

## What's open — Tier 1 (in priority order)

### T1-A. F-008 — SQLite FTS5 full-text search across spans
- **Spec:** `ai-docs/specs/F-008-fts5-fulltext-search.md`
- **Repo:** `~/workspase/projects/agenttrace` (Workshop, not plugin)
- **Estimated effort:** 3-5 days
- **Why this first:** It's the most painful gap in daily use. You literally cannot search "where did my LLM say 'Connection refused'" today.
- **Where to start:** Read the spec, start with F-008-P1 (storage layer).

### T1-B. F-011 — Bug fix: `loadConfig()` cwd vs project root
- **Spec:** `ai-docs/specs/F-011-loadconfig-cwd-bug.md`
- **Repo:** `~/workspase/projects/agenttrace-opencode-plugin` (Plugin, not Workshop)
- **Estimated effort:** 1-2 hours
- **Why this is small but important:** Without this fix, multi-project isolation (per-`eventName` dashboards) doesn't work — all sessions land as `event_name="opencode_session"` regardless of `raindrop.json` in cwd.
- **Where to start:** Read the spec, do F-011-P1 (3 lines change in `loadConfig()`).

## State on disk (as of 2026-09-04)

| Path | State |
|---|---|
| `~/workspase/projects/agenttrace/ai-docs/PLAN.md` | Synced, has Tier 1 roadmap section at top |
| `~/workspase/projects/agenttrace/ai-docs/specs/F-008-fts5-fulltext-search.md` | Ready to implement |
| `~/workspase/projects/agenttrace-opencode-plugin/ai-docs/PLAN.md` | Synced, has Tier 1 roadmap section at top |
| `~/workspase/projects/agenttrace-opencode-plugin/ai-docs/specs/F-011-loadconfig-cwd-bug.md` | Ready to implement |
| `~/workspase/projects/agenttrace-opencode-plugin/dist/{index.js,index.cjs}` | At v0.1.0-kolya.12 (F-005 shipped) |
| `~/.config/opencode/plugins/opencode-workshop-plugin.js` | Static copy at kolya.12 |
| Workshop daemon | Running on pid 2202413 via `bun --watch src/index.ts workshop serve` — do NOT restart unless Kolya tells you to (NO SELF-RESTART rule) |
| `~/.raindrop/raindrop_workshop.db` | ~520 spans, ~30 runs, all eventName="opencode_session" except new F-005/F-013 tests |

## What's closed (so you don't redo it)

- F-001 (Cloud removal) — closed 2026-07-21
- F-002 (Codex/Claude removal) — Deferred 0-priority; status noted in PLAN.md
- F-003 (subagent_name on task spans) — Closed 2026-09-01, rolled into F-010
- F-004 (Phoenix-style spans UI) — Closed 2026-07-21
- F-005 (HTML export) — Closed 2026-07-21
- F-005-plugin (env-var precedence) — Closed 2026-09-04 via commit c4b81b0
- F-010 v1/v2 (subagent_name recovery) — Closed 2026-09-01 via commit 36dda75
- F-012 (Workshop StatsPanel + Convo Stats + SpanDetail parent/children) — Closed 2026-09-04 via commit f0cadd3
- F-013 (status=ERROR + end_time_ms always) — Closed 2026-09-04 via commit 5d2907b

## Critical constraints (do NOT violate)

- **No auto-commit / no auto-push** — every commit + push requires Kolya's explicit word ("коммить", "пуш").
- **No daemon restart** — `raindrop workshop serve` is on pid 2202413; restart only if Kolya says so. The `bun --watch` daemon already auto-reloads on `src/` changes; `app/dist/` does NOT auto-rebuild.
- **Auth.json untouched** — never read or modify `~/.config/opencode/auth.json` or similar.
- **clarify is broken** — send questions as text in your reply, don't expect the UI form.
- **Visual honesty** — screenshots must be from real Playwright captures (use `executable_path=chromium_headless_shell-1223`), not matplotlib renders.

## Known side discoveries (FYI, not bugs to fix unless asked)

- `RAINDROP_WORKSHOP=enable/disable` form doesn't work in this fork's readEnvVar shim (both Bun and Node ESM). Cosmetic; URL form works. Documented in F-005 unit test driver.
- `RAINDROP_DEBUG=true` logs are suppressed by `trace_only: true` in raindrop.json — to debug, either disable `trace_only` or read `~/.raindrop/trace.log`.
- `f012-shot.py` / `ws-final-*.png` screenshots from F-012 session are in `/tmp/f012-*.png` (still there, ~700KB total).

## How to pick up

1. Read this file.
2. Read `ai-docs/PLAN.md` in the relevant repo.
3. Read the spec for the Feature you're tackling.
4. Do the work. Update PLAN.md in the same commit as the code change.
5. **Stop before pushing.** Tell Kolya it's ready; wait for "пуш".

## Last 5 commits (most recent first)

Workshop (`102ec9b` HEAD):
- `102ec9b` docs: add F-012 Active Feature + status note on F-002
- `f0cadd3` feat(F-012): collapsible Statistics + Convo Statistics + span parent/children
- `d77932a` feat(F-003): Pattern-3 task detection + subagent_name contract

Plugin (`c4b81b0` HEAD):
- `c4b81b0` feat(F-005): env-var precedence guard for non-local RAINDROP_LOCAL_WORKSHOP_URL
- `0778171` docs: sync PLAN.md with closed features
- `5d2907b` feat(F-013): tool.execute.after propagates error → status=ERROR in spans
- `36dda75` feat(F-010 v2): recover subagent_name for nested sub-agents in OpenCode 1.18
- `b2e72da` fix(F-010): bump PLUGIN_VERSION to 0.1.0-kolya.9 in dist bundles

---

*Handoff maintained by Miko. Last updated 2026-09-04.*

# AGENTS.md — pair doc for Kolya's opencode-workshop fork

> **For:** AI agents (Miko / Hermes / Claude Code / OpenCode sub-agents) working in this repo.
> **Read alongside:** [`../AGENTS.md`](../AGENTS.md) (upstream workshop guide — has the build/dev commands and the user-vs-developer fork)
> **Single source of truth:** [`PLAN.md`](PLAN.md) (current Features + todos, updated per-commit)
> **Handoff file:** [`HANDOFF.md`](HANDOFF.md) (for cross-session continuity — what's done, what's blocked, what's open)

---

## What this project is (Kolya's fork specifically)

This is **Kolya's maintained fork** of the OSS [raindrop-ai/workshop](https://github.com/raindrop-ai/workshop), **stripped down to the local debugger only**. The cloud product at `app.raindrop.ai` has been removed (see F-001 in PLAN.md); Codex + Claude Code integrations have been replaced with OpenCode-only equivalents (F-002).

**Public repo:** https://github.com/nikolay-grudanov/opencode-workshop

**Why the fork exists:**

1. Kolya runs a **pure-local** stack: OpenCode → opencode-workshop-plugin (his fork) → local Workshop daemon on `localhost:5899`. No cloud, no paid plans, no OAuth.
2. Sub-agents spawned by OpenCode's `task` tool should be **visible and named** in the Workshop UI (F-003).
3. Span tree should match **Phoenix-style** OpenTelemetry GenAI conventions (F-004).
4. Static HTML export of any run, with embedded styles and no remote leaks (F-005 — ported from `hermes-webui/api/session_export_html.py`).
5. The companion plugin (`@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.6`, separate repo) feeds this fork with fixed MCP-tool span data.

---

## What an agent must read before acting

1. **This file** (you are here).
2. **[`../AGENTS.md`](../AGENTS.md)** — upstream guide. Tells you how to build (bun) and run (`bun run dev`).
3. **[`PLAN.md`](PLAN.md)** — current Features and open todos. **Update in the same commit as the code change.**
4. **(Optional)** [`HANDOFF.md`](HANDOFF.md) — last-session summary, useful after long pauses.
5. **Know the related repos:**
   - Plugin: `~/workspase/projects/agenttrace-opencode-plugin/` (publishes spans to this Workshop daemon)
   - Plugin's own docs: that repo's `ai-docs/PLAN.md`
   - Hermes WebUI: `/home/gna/hermes-webui/` (has `session_export_html.py`, the prototype F-005 ports from)

---

## Working conventions in this repo

### Scope: ONLY the local debugger
- ❌ **Never** add `app.raindrop.ai`, OAuth, paid plans, write-keys, cloud-MCP — these are removed in F-001 and the rules forbid re-adding them.
- ❌ **Never** add Codex, Claude Code, Anthropic-specific code — replaced in F-002.
- ✅ OpenCode-only: anything you add must work against the opencode-workshop-plugin (V2 plugin API, MCP tool calls, `task` sub-agent tool).

### Local install / testing
The daemon has its own installer (`install.sh` in upstream, runs `raindrop workshop start`). For dev work use `bun install && bun run dev` (see upstream AGENTS.md) — this is what we use to test F-001..F-005.

### PLAN.md is the single source of truth
- Same F-feature convention as the plugin fork: `### F-NNN` sections, `- [ ]` / `- [x]` markdown checkboxes.
- Add new Features at the **top**. Newest F-number first.
- Closed Features move to "## Closed Features" at the **bottom**, with "Closed YYYY-MM-DD" note.
- One commit = one Feature or one Feature-step, with the checkbox flipped in the same commit.

### Do not touch (upstream-owned)
- ❌ `AGENTS.md` at repo root — upstream's guide, leave as-is.
- ❌ `docs/` — upstream docs, only update if explicitly told to.
- ❌ `LICENSE` — MIT, upstream.
- ❌ `bun.lock` — Bun lockfile, commit after `bun install`.

### Build & test
```bash
bun install
bun run dev     # Workshop daemon + Vite UI on http://localhost:5899
bun run lint
bun run build
bun x tsc --noEmit
```

Smoke test procedure:
1. Start daemon (`bun run dev` or `raindrop workshop start`)
2. Run OpenCode with our plugin against an MCP tool (like fff)
3. Verify span lands in DB (`curl http://localhost:5899/api/runs?limit=1`)
4. Open UI in browser, click into the run, verify span tree

### Git workflow
- One commit per logical change. Conventional commits: `fix:`, `feat:`, `chore:`, `docs:`, `refactor:`.
- Reference Feature ID in the commit body, e.g. `Refs F-001.`.
- **Never push without Kolya's explicit "push"** — see Miko-no-auto-commit rule in memory.

---

## Quick reference

| Need | File |
|---|---|
| Current plan / todos | [`PLAN.md`](PLAN.md) |
| Last session snapshot | [`HANDOFF.md`](HANDOFF.md) |
| Upstream build/dev guide | [`../AGENTS.md`](../AGENTS.md) |
| Module map, data flow, fork boundary | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| HTTP + WebSocket surface, error shapes | [`API.md`](API.md) |
| SQLite schema, migrations, ops recipes | [`DATABASE.md`](DATABASE.md) |
| OTLP ingest contract, span shape, env vars | [`PLUGIN-CONTRACT.md`](PLUGIN-CONTRACT.md) |
| Dev env, scripts, smoke test, lint/typecheck | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| Span normalization | `src/spans/normalize.ts` |
| Sub-agent detection | `src/agents.ts` |
| Replay logic | `src/replay.ts` |
| HTML export prototype (F-005 input) | `/home/gna/hermes-webui/api/session_export_html.py` |
| Companion plugin | `~/workspase/projects/agenttrace-opencode-plugin/ai-docs/PLAN.md` |
| Workshop API base | `http://localhost:5899/api/` (e.g. `/api/runs?limit=N`, `/api/runs/:id/outline`) |

---

*Maintained by Nikolai Grudanov (MIFI, M.Sc. 01.04.02) via Miko (Hermes Agent). Forked 2026-07-10 from upstream `raindrop-ai/workshop`.*

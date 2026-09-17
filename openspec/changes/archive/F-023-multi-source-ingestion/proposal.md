# F-023 — Multi-source agent instrumentation (Qwen Code + GigaCode)

> **Status:** Plan-only (Kolya: «не приступай к разработке а просто запиши план»). No code yet.
> **Author:** Miko (Hermes Agent). **Date:** 2026-09-17. **Revised:** 2026-09-17 (channel simplification, new repo).
> **Repos:**
> - `opencode-workshop` (daemon — small changes: accept source field, UI badge)
> - `opencode-workshop-plugin` (NO change)
> - **`openworkshop-qwen-bridge`** (NEW REPO — TS/Node HTTP server that translates Qwen/GigaCode HTTP-hook events into the OpenCode plugin's existing JSON wire format and POSTs to `localhost:5899/v1/`)

## Context

Workshop (Kolya's fork of `raindrop-ai/workshop`) currently ingests spans from **OpenCode only**, via our companion plugin `@grudanov-nikolay/opencode-workshop-plugin` which hooks the OpenCode SDK (`tool.execute.{before,after}`, `chat.message`, `session.created`, etc.) and POSTs OTLP-shaped JSON to `localhost:5899/v1/`.

Two additional agent CLIs are now in scope:

1. **Qwen Code** (`QwenLM/qwen-code`) — Alibaba's fork of Gemini CLI. Has both native OpenTelemetry export AND an HTTP-hook system (`PreToolUse`/`PostToolUse`/`Stop`/`SubagentStop`/`UserPromptSubmit`) configurable via `.qwen/settings.json`. Hooks send JSON to a configurable URL.
2. **GigaCode** — Sberbank's fork of Qwen Code with **OTLP REMOVED**. Only the HTTP-hook system is available. Kolya: «В gigacode cli это форк qwencode вырезали otlp так что будем работать на хуках.» Not installed locally on Kolya's machine. A separate agent on Kolya's corporate PC is authoring a GigaCode-specific adapter separately; that adapter targets the **same wire contract** we define here. Validation only on corporate laptop.

**Both are non-Claude / non-Codex / non-Anthropic** — this feature does not violate the `openspec/config.yaml` HARD constraint «OpenCode-only. NEVER add Codex / Claude Code / Anthropic-specific code.» They are a separate class of tools (Gemini-CLI-family forks) that happen to expose a hooks-based extension API. The bridge translates hook events into the OpenCode plugin's wire format — the Workshop daemon itself does not need to know that Qwen Code / GigaCode exist, beyond tagging the run with `agent_provider`.

## Architectural decision: bridge, not adapter-in-daemon

**Insight:** the existing OpenCode plugin already POSTs JSON to `localhost:5899/v1/` in a well-defined wire format (see `src/parse.ts` plus the plugin's `EventShipper`). The simplest path is to write a **separate HTTP server** that:
1. Receives Qwen Code / GigaCode hook events on its own port (e.g. `:5898`).
2. Translates them into the same wire format the OpenCode plugin emits.
3. Forwards them to `localhost:5899/v1/` as if they came from the OpenCode plugin.

**Why a separate repo, not a daemon-internal handler:**
- Qwen Code and GigaCode are community tools, not Kolya's fork. Putting their code into `opencode-workshop` pollutes the daemon's codebase with vendor-specific translation that the project (`openspec/config.yaml`) does not want to own.
- A separate npm package `@grudanov-nikolay/openworkshop-qwen-bridge` follows the same pattern as `@grudanov-nikolay/opencode-workshop-plugin` — installable via `npm i -g`, runs out-of-process, single responsibility.
- The corporate agent that writes the GigaCode adapter can publish to its own repo / PR against ours without touching Workshop.
- TypeScript / Node-only stack: every Qwen Code / GigaCode user has Node.js preinstalled (Qwen Code ships as a Node CLI). No Bun dependency.

**Result:** F-023 = 3 small commits in 2 repos.
- `openworkshop-qwen-bridge` (NEW): ~300 LOC Node HTTP server. Stages 1-3 of this plan live here.
- `opencode-workshop`: small extension to `parseOtlpRequest` to read `agent_provider` field + UI badge + facet. Stages 4-6.
- `opencode-workshop-plugin`: NO change. The bridge impersonates it.

## Goal

Enable Workshop to ingest, normalize, persist and visualize telemetry from Qwen Code (now) and GigaCode (later, validatable only on corporate laptop) with the same fidelity as today's OpenCode traces — spans, tokens, tool calls, sub-agents, errors, conversation flow — plus a visible «Source» badge so operators can tell `OpenCode`, `Qwen Code`, `GigaCode` runs apart in `RunsPage` and `SearchPage`. **The mechanism is HTTP hooks only** (no OTLP), via the bridge.

## Non-goals (Scope OUT)

- **No Codex / Claude Code / Anthropic adapters.** `openspec/config.yaml` HARD rule. We do NOT add `codex-cli-chat.ts`-style bridges, Anthropic-specific code, or vendor-SDK adapters for Claude / Codex / Pi / Amp. See F-002 (closed 2026-09-01) for the precedent of explicit removal.
- **No OTLP receiver in Workshop.** Kolya: «qwencode тоже на хуках». So we drop Channel C — bridges-only architecture. If we ever want OTLP later, that's F-028.
- **No GigaCode-specific code in our repo** in this iteration. The corporate agent writes it; we only define the **wire contract** that any hook-emitting tool must follow to be ingested by Workshop via the bridge. GigaCode smoke-test only happens after corporate laptop deployment.
- **No upstream `raindrop-ai/workshop` sync.** This is a Kolya-fork-only feature. Do not propose upstream-merge until v0.1.0 ships.
- **No native plugin for Qwen Code / GigaCode written against OpenCode SDK.** They use their own hook system. The bridge translates, Workshop stays SDK-agnostic.
- **No cloud / SaaS hooks** — strictly local. Bridge binds to `127.0.0.1:5898` only; localhost-origin guard enforced.

## Decisions (with rationale)

| # | Decision | Rationale | Reversible? |
|---|---|---|---|
| D1 | **Channel B (HTTP hooks) only — drop OTLP from F-023 scope** | Kolya: «gigacode вырезали otlp так что будем работать на хуках. ... также важно чтоб и qwencode работал, давай его тоже на хуках сделаем». Single channel = uniform code path, no OTLP receiver to maintain in Workshop. | Yes — re-add OTLP as F-028 without breaking D2-D7. |
| D2 | **New repo `openworkshop-qwen-bridge`** (TypeScript / Node, npm) | Separate vendor-specific translation from Workshop daemon. Matches pattern of `opencode-workshop-plugin`. Node-only because every Qwen/GigaCode user has Node preinstalled. | Yes — code can be inlined into Workshop as F-029 if the bridge proves to be a permanent coupling. |
| D3 | **Bridge impersonates the OpenCode plugin's wire format** | The OpenCode plugin already POSTs JSON to `localhost:5899/v1/`. Re-using that format means: (a) zero changes to Workshop's OTLP-shaped ingestion path beyond reading a new `agent_provider` field; (b) the existing `src/parse.ts` already normalizes AI-SDK-style spans — the bridge translates Qwen hook events into that same shape. | Yes — switch to a new format (e.g. OTLP) without changing Workshop's other adapters. |
| D4 | **`agent_provider` lives in `runs.metadata` as a JSON field** (no new column) | Adding `runs.source` would collide semantically with `annotations.source` enum `["user","opencode"]` (existing). Using `runs.metadata` JSON avoids migration and zero ambiguity. Cost: no index → facet query slower (acceptable at <10k runs). | Yes — promote to a proper indexed column if perf demands it. |
| D5 | **Bridge HTTP server binds to `127.0.0.1:5898` only** | Local-only debugger, same security posture as Workshop daemon. SSRF protection: hook handlers reject non-loopback. | Yes — if a remote deployment becomes needed, additional guard rails. |
| D6 | **Rate-limit: 5000 hook events / min per `agent_provider`** | Qwen Code normal rate ≈ 200 events/min (5 turn safety margin). | Yes — tune if exceeded. |
| D7 | **UI source-aware: badge in `RunsPage` + facet in `/api/facets` + filter in `SearchPage` + chip in `RunDetail`** | Kolya chose «yes, immediately» in scope-check Q5. Without UI, F-023 is invisible to operators. | Yes — UI changes are additive. |
| D8 | **GigaCode = same wire contract as Qwen Code (write once, support both via config)** | Kolya: «Он [агент] будет сам разрабатывать адаптер для gigacode нам главное на своей стороне все заложить». We define the contract; the corporate agent implements GigaCode→contract translation in their own adapter (in our repo or theirs). | Yes — if GigaCode diverges, F-024 adds GigaCode-specific code path. |
| D9 | **Bridge identifies agent via URL path or `X-Agent-Provider` header, not just `User-Agent`** | Path-based is most reliable (`/qwen` vs `/gigacode`), header as fallback. Lets us run one bridge process serving both tools. | Yes. |
| D10 | **Bridge is always read-only toward Workshop** (`forward` not `inject`) | Passive debugger only. We never inject `additionalContext`, never block tool calls. Per F-023 review Q9. | Yes. |
| D11 | **Wire contract is documented in `ai-docs/specs/F-023-wire-contract.md`** | Single source of truth for the corporate GigaCode-adapter author and any future bridge author. | Yes. |
| D12 | **Bridge uses `http` stdlib only, no Express** | Standard node http module is enough for ~10 routes. Keeps the package small (target: <100 KB installed). Matches `@grudanov-nikolay/opencode-workshop-plugin` philosophy. | Yes — switch to Fastify if perf demands. |
| D13 | **Bridge emits standard AI-SDK-style spans, not Qwen-specific** | Workshop's `aiSdkLlmAdapter` and `aiSdkToolAdapter` (`src/spans/adapters/ai-sdk.ts`) already parse `ai.prompt.messages`, `ai.toolCall.name`, `ai.toolCall.args`, `ai.toolCall.result`. The bridge translates Qwen events into this shape. Workshop never needs a `qwen*` adapter. | Yes — if Qwen-specific data needs richer rendering, F-030 adds a dedicated adapter. |

## Scope (anchors)

### `openworkshop-qwen-bridge` repo (NEW, primary work)

- `package.json` — name `@grudanov-nikolay/openworkshop-qwen-bridge`, version `0.0.1`, dependencies: `zod` (env validation), nothing else.
- `src/server.ts` — stdlib HTTP server on `127.0.0.1:5898`. Routes: `POST /qwen/hook`, `POST /gigacode/hook`, `GET /health`, `GET /ready`.
- `src/handler-qwen.ts` — Qwen Code hook handler. Receives `PreToolUse`/`PostToolUse`/`Stop`/`SubagentStop` JSON, calls translator.
- `src/handler-gigacode.ts` — placeholder/stub. Documents the wire contract; corporate agent fills it in.
- `src/translator.ts` — converts hook event → OpenCode-plugin-shaped spans.
- `src/wire-format.ts` — typed wire-format definition (zod schemas).
- `src/shipper.ts` — POSTs spans to `localhost:5899/v1/` (same payload shape the OpenCode plugin emits).
- `src/config.ts` — env-var loader with rate-limit + URL overrides. Pattern borrowed from `opencode-workshop-plugin`'s env-var hardening (F-005 verified pattern: `isLocalUrl()` fallback).
- `src/logger.ts` — minimal leveled logger.
- `tests/handler-qwen.test.ts` — 6+ unit tests on translated output.
- `tests/shipper.test.ts` — nock-style HTTP mocking of upstream.
- `ai-docs/PLAN.md` — F-024-style feature tracker.
- `ai-docs/specs/F-023-wire-contract.md` — the wire contract document (consumed by corporate agent).
- `README.md` — install + run.
- `.github/workflows/ci.yml` — `tsc --noEmit` + `node --check` + `bun test`.

### `opencode-workshop` repo — minimal changes

- `src/parse.ts:148` (`parseOtlpRequest`) — extract `attributes["agent_provider"]` (or `body.agent_provider`) into a top-level `agentProvider` field on `ParsedSpan`.
- `src/db.ts:237` (`upsertRun`) — accept `agentProvider?: string` and write to `metadata` JSON (merge with existing).
- `src/db.ts:390` (`computeFacets`) — add `agentProviders: string[]` field.
- `src/db.ts:417` (`searchSpans`) — accept `agentProvider?: string` filter, JOIN on `runs.metadata`.
- `app/src/components/RunsPage.tsx` — column or chip with source.
- `app/src/components/SearchPage.tsx` — agent provider filter input.
- `app/src/i18n/locales/{en,ru}.json` — labels.
- `tests/parse-agent-provider.test.ts` — unit tests for the metadata extraction.
- `tests/db-agent-provider.test.ts` — `computeFacets`, `searchSpans` new behavior.
- `README.md` — «Supported sources» table.

### `opencode-workshop-plugin` repo — NO change

The OpenCode plugin hooks OpenCode SDK events. The bridge impersonates its wire format when forwarding Qwen/GigaCode hook events. The plugin itself doesn't need to know about either tool.

## Stages (commit-ready, multi-repo)

Each stage = one Feature-step, each commit is independently buildable/testable. **New repo gets its own commits first** (Stages 1-3), then `opencode-workshop` patches (Stages 4-5), then docs + release (Stage 6).

### Stage 0. Research + ADR + new repo bootstrap (½ day)

**M0.1** (DONE 2026-09-17) Create `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md`, `openspec/specs/source-aware-ingestion/spec.md`, `ai-docs/specs/F-023-multi-source-ingestion-research.md`, update umbrella `ai-docs/PLAN.md` + `STATUS.md`.
- Test: 4 files exist, sizes > 0.

**M0.2** Create new repo `openworkshop-qwen-bridge`:
```bash
mkdir -p ~/workspase/projects/openworkshop-qwen-bridge
cd ~/workspase/projects/openworkshop-qwen-bridge
git init
# copy skeleton: package.json, tsconfig.json, .gitignore, src/, tests/
```
- `package.json` with `@grudanov-nikolay/openworkshop-qwen-bridge` namespace, license MIT dual copyright (Raindrop AI + Nikolai Grudanov).
- `tsconfig.json` strict, target ES2022.
- `.gitignore` `node_modules/`, `dist/`.
- Test: `bun install` succeeds, `bun x tsc --noEmit` exits 0.

**M0.3** Update umbrella `AGENTS.md` (`~/workspase/projects/opencode-workshop-stack/AGENTS.md`) to add the new sibling repo to the architecture diagram and repo table.

**M0.4** Update both PLAN.md's to add F-023 entry pointing to the new repo (already done in workshop; needs to be added in `openworkshop-qwen-bridge` once the repo exists).

### Stage 1. Wire contract (lives in `openworkshop-qwen-bridge`)

**M1.1** `ai-docs/specs/F-023-wire-contract.md` — define the exact JSON shape the bridge emits to Workshop. Borrow from `src/spans/adapters/ai-sdk.ts` `aiSdkLlmAdapter` + `aiSdkToolAdapter` for reference. Document:
- HTTP envelope (POST `localhost:5899/v1/...`, JSON content-type, optional `X-Workshop-Token` header).
- Span payload shape per span type (LLM, Tool, Agent).
- Hook event → span translation table (PreToolUse → synthetic TOOL_CALL begin; PostToolUse → synthetic TOOL_CALL end; Stop → close root; SubagentStop → close sub-agent).
- Error envelope format.
- Rate-limit semantics (server returns 429 + `Retry-After`).
- Test: document reviewed and approved by Kolya.

**M1.2** `src/wire-format.ts` — zod schemas for both:
- Input (Qwen hook events): `qwenHookEventSchema`, `qwenPreToolUseSchema`, `qwenPostToolUseSchema`, `qwenStopSchema`, `qwenSubagentStopSchema`, `gigacodeHookEventSchema`.
- Output (Workshop spans): `workshopSpanSchema` (matches `ParsedSpan` in `opencode-workshop/src/parse.ts:5-18`).
- Test: 5 zod-parse success cases + 3 failure cases per schema.

**M1.3** `tests/wire-format.test.ts` — round-trip test: Qwen sample JSON → parsed event → translated span → asserted against `workshopSpanSchema`. Tests:
- Qwen `PreToolUse` example from research.md → produces 1 span with `span_type=TOOL_CALL`, `end_time_ms=null`, `attributes["ai.toolCall.name"]="run_shell_command"`.
- Qwen `PostToolUse` example → produces 0 new spans but emits close-event (or updates existing).
- Qwen `Stop` → closes root run.
- Qwen `SubagentStop` → closes sub-agent span.
- Malformed input → returns 400 with `{error: "..."}`.

### Stage 2. Translator (lives in `openworkshop-qwen-bridge`)

**M2.1** `src/translator.ts` — pure function `translateHookEvent(event: QwenHookEvent, ctx: TranslatorCtx): WorkshopSpan | null`:
- In-memory span cache (key = `conversation_id + tool_use_id`) so `PreToolUse` can be matched with `PostToolUse`.
- `gen_ai.conversation.id` → `runs.convo_id`.
- `tool.name` → `attributes["ai.toolCall.name"]`.
- `tool_input` → `attributes["ai.toolCall.args"]` (stringified JSON).
- `tool_response` → `attributes["ai.toolCall.result"]` (stringified JSON).
- `agent.name` (sub-agent) → `attributes["subagent_name"]`.
- Test: 8+ unit tests covering each event type + edge cases (missing fields, malformed JSON, large payloads >256 KiB clamp).

**M2.2** `src/shipper.ts` — POSTs translated spans to `localhost:5899/v1/`. Uses stdlib `fetch` (Node 18+).
- Configurable upstream URL via env (`WORKSHOP_URL`, default `http://localhost:5899`).
- Same env-var hardening pattern as F-005: `isLocalUrl()` guard, fall back to default if env value is non-local.
- Retry on 429 with `Retry-After`. Exponential backoff on transient errors.
- Test: mock 200 / 429 / 500 / network error, assert correct retry behavior.

**M2.3** `src/server.ts` — stdlib HTTP server:
- `POST /qwen/hook` → `handleQwenHook` → `translateHookEvent` → `shipper`.
- `POST /gigacode/hook` → `handleGigacodeHook` (stub for now, returns 501 with `{error: "gigacode adapter pending — see ai-docs/specs/F-023-wire-contract.md"}`).
- `GET /health` → `{ok: true, version: "0.0.1"}`.
- `GET /ready` → 200 if upstream Workshop is reachable.
- Test: integration tests with `node:test` + `node:http` for full request → response.

### Stage 3. Bridge hardening + smoke (lives in `openworkshop-qwen-bridge`)

**M3.1** `src/config.ts` — env-var loader:
- `BRIDGE_PORT` (default 5898)
- `WORKSHOP_URL` (default `http://localhost:5899`) with `isLocalUrl` guard
- `BRIDGE_LOG_LEVEL` (default `info`)
- `BRIDGE_RATE_LIMIT_PER_MIN` (default 5000)
- Test: 5 cases per env var.

**M3.2** `src/logger.ts` — leveled logger with rate-limited warning (F-005 pattern).

**M3.3** Rate-limit middleware in `src/server.ts` — token-bucket per `agent_provider` per minute.

**M3.4** `.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun x tsc --noEmit
      - run: bun test
      - run: node --check dist/index.js  # if applicable
```

**M3.5** First npm release `0.0.1` via Kolya's `npm publish` action. Public alpha; same dual copyright as the plugin and workshop.

### Stage 4. Workshop accepts `agent_provider` (`opencode-workshop` repo)

**M4.1** `src/parse.ts` — extract `agent_provider` from attributes JSON in `parseOtlpRequest` and expose on `ParsedSpan`:
```ts
const agentProvider = getAttr(attrs, "agent_provider") as string | undefined;
// add to returned ParsedSpan shape
```
- Test: 5 cases in `tests/parse-agent-provider.test.ts` — explicit `agent_provider="qwen_code"`, missing → undefined, malformed → undefined.

**M4.2** `src/db.ts:upsertRun` — accept `agentProvider?: string`:
```ts
// merge into existing metadata JSON
const existingMeta = run.metadata ? JSON.parse(run.metadata) : {};
const newMeta = { ...existingMeta, ...(agentProvider && { agent_provider: agentProvider }) };
metadata: JSON.stringify(newMeta)
```
- Test: existing metadata preserved + agent_provider added.

**M4.3** `src/db.ts:computeFacets` — add `agentProviders: string[]`:
```sql
SELECT DISTINCT json_extract(metadata, '$.agent_provider') AS p
FROM runs
WHERE json_extract(metadata, '$.agent_provider') IS NOT NULL
ORDER BY p
LIMIT 50
```
- Test: returns distinct values across mixed run set.

**M4.4** `src/db.ts:searchSpans` — add `agentProvider?: string` filter:
```sql
JOIN runs r ON s.run_id = r.id
WHERE (? IS NULL OR json_extract(r.metadata, '$.agent_provider') = ?)
```
- Test: 3 cases — filter present, absent, NULL.

### Stage 5. UI source-aware (`opencode-workshop` repo)

**M5.1** `app/src/components/RunsPage.tsx` — add `Agent Provider` chip next to existing badges (USER/CONVO/TRACE). Colours: OpenCode (default), Qwen Code (teal, matches `COMPRESSION`), GigaCode (gold).
- Test: screenshot in IAB via playwright (UI tests don't exist in this repo).

**M5.2** `app/src/components/SearchPage.tsx` — add `<datalist>` for `agent_provider` filter (populated from `/api/facets`).
- Test: manual visual + API smoke (`?agent_provider=qwen_code` returns Qwen Code runs).

**M5.3** `app/src/components/RunDetail.tsx` — small chip in header.
- Test: screenshot.

**M5.4** `app/src/i18n/locales/{en,ru}.json` — keys: `sources.opencode`, `sources.qwen_code`, `sources.gigacode`, `search.agentProvider`.
- Test: switch to RU, label renders.

### Stage 6. End-to-end live smoke (both repos)

**M6.1** Qwen Code `.qwen/settings.json` recipe:
```json
{
  "security": { "allowPrivateNetworkHooks": true },
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:5898/qwen/hook", "timeout": 10 }] }],
    "PostToolUse": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:5898/qwen/hook", "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:5898/qwen/hook", "timeout": 10 }] }],
    "SubagentStop": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:5898/qwen/hook", "timeout": 10 }] }]
  }
}
```
- Test: document reviewed.

**M6.2** Live smoke run: start Workshop daemon → start bridge → start Qwen Code with the config above → run a prompt with at least one tool call.
- Smoke checks:
  - Bridge logs show events received.
  - Bridge forwards to Workshop.
  - `sqlite3 ~/.raindrop/raindrop_workshop.db "SELECT id, json_extract(metadata,'$.agent_provider') FROM runs ORDER BY last_updated_at DESC LIMIT 3"` shows new run with `agent_provider="qwen_code"`.
  - UI shows badge «Qwen Code».
  - Search filter `?agent_provider=qwen_code` returns the run.

**M6.3** Same smoke for GigaCode happens on corporate laptop, not in this iteration.

### Stage 7. Documentation + release (both repos)

**M7.1** `opencode-workshop/README.md` — add «Supported sources» table.
**M7.2** `openworkshop-qwen-bridge/README.md` — install + run + Qwen config example.
**M7.3** `opencode-workshop-stack/STATUS.md` — add `openworkshop-qwen-bridge@0.0.1` row, mark F-023 closed.
**M7.4** `hindsight_retain` — record F-023 shipped (AGENTS.md hard rule #6).
**M7.5** Releases: `npm publish` for both packages, tags `v0.0.1`, GitHub releases.

## Acceptance criteria (whole feature)

- [ ] `openworkshop-qwen-bridge` repo exists at `~/workspase/projects/openworkshop-qwen-bridge/`.
- [ ] `cd openworkshop-qwen-bridge && bun install && bun x tsc --noEmit && bun test` green.
- [ ] `cd opencode-workshop && bun x tsc --noEmit && bun run lint && bun test tests/ && bun run build:ui` green.
- [ ] Live smoke: Qwen Code → bridge → Workshop → DB row with `agent_provider="qwen_code"` AND UI badge.
- [ ] UI: source badge renders for OpenCode / Qwen Code / GigaCode (GigaCode badge visible even with no data yet).
- [ ] i18n: source labels present in en.json and ru.json.
- [ ] `STATUS.md` updated, `hindsight_retain` done.

## Out of scope for F-024+ (next iterations)

- **F-024:** GigaCode-specific adapter code (lives in `openworkshop-qwen-bridge/handler-gigacode.ts`) once corporate agent validates Qwen compat.
- **F-025:** OTLP receiver in Workshop (Channel A of the original triple; deferred since GigaCode dropped OTLP).
- **F-026:** Source-aware stats panel in `ConvoDetail`.
- **F-027:** Cross-source conversation linking (same `gen_ai.conversation.id` from multiple sources → unified convo).

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Corporate GigaCode agent diverges from our wire contract | Medium | Medium | Wire contract documented at Stage 1; we publish it before they implement. Round-trip tests in Stage 1 are the contract's executable spec. |
| Bridge becomes bottleneck for high-throughput agents | Low | Medium | Rate-limit at 5000/min. Document bottleneck. Future: HTTP/2 multiplex, batched shipper. |
| Kolya unavailable for daemon restart | Medium | Low | Stage 6 explicitly requires Kolya's daemon restart. No workaround per AGENTS.md hard rule. |
| `Qwen Code hook URL whitelist` rejects `127.0.0.1` | Low | High | Stage 6.1 explicitly sets `security.allowPrivateNetworkHooks: true`. |
| Bridge written in Node, but Workshop is Bun | Low | Low | Bridge is independent process. No shared runtime. Tested via stdlib http only. |

## References

- `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md` — this file.
- `openspec/specs/source-aware-ingestion/spec.md` — capability spec.
- `ai-docs/specs/F-023-multi-source-ingestion-research.md` — research + Qwen span inventory.
- `src/spans/adapters/ai-sdk.ts` — AI-SDK adapter that bridge output targets.
- `src/parse.ts:148` — `parseOtlpRequest`, the function we extend.
- `src/db.ts:237` — `upsertRun`, where agent_provider gets stored.
- `openspec/config.yaml` — proposal format conventions, hard rules.
- Qwen Code hooks docs: `qwenlm.github.io/qwen-code-docs/en/users/features/hooks/`.
- Qwen Code telemetry docs: `docs/developers/development/telemetry.md`.
- F-005 env-var hardening pattern (Workshop-plugin skill).

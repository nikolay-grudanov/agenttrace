# Source-aware ingestion spec (Qwen Code + GigaCode)

> **Status:** Capability spec. Implementation lives in change `openspec/changes/archive/F-023-multi-source-ingestion/`.
> **Author:** Miko (Hermes Agent). **Date:** 2026-09-17.

## Purpose

Workshop (Kolya's fork of `raindrop-ai/workshop`) currently ingests spans from OpenCode only. This spec describes the capability needed to **also** ingest telemetry from Qwen Code (Alibaba's Gemini-CLI fork) and GigaCode (Sberbank's Qwen-Code fork) without violating the project's hard constraint "OpenCode-only — never add Codex/Claude/Anthropic-specific code."

The capability targets the **OpenTelemetry GenAI Semantic Conventions** standard, which Qwen Code and GigaCode emit natively. No vendor-SDK adapter is introduced. The result is that Workshop accepts spans from any agent CLI that follows OTel GenAI-SC — a forward-compatible extension point that future tools (e.g. a hypothetical SberCode v2, or any Gemini-CLI family fork) get for free.

## Requirements

### R1. Ingest Qwen Code telemetry via OTLP/HTTP

- **R1.1** Workshop MUST accept OTLP/HTTP POST at `http://localhost:5899/v1/traces` from any agent whose `service.name` resource attribute is `qwen-code` (or compatible: `sandbox-agent` for GigaCode).
- **R1.2** Each ingested span MUST be tagged with `source='qwen_code'` (or `'gigacode'` for sandbox-agent) in the `runs.source` and `spans.source` columns.
- **R1.3** Qwen Code spans that carry `gen_ai.*` SC attributes MUST be normalized via a dedicated adapter (`qwenGenAiLlmAdapter`, `qwenGenAiToolAdapter`, `qwenSubagentAdapter`) BEFORE the existing `aiSdk*` adapters are tried (so Qwen Code spans are not mis-classified as AI SDK spans).

### R2. Ingest Qwen Code hook events via dedicated HTTP endpoint

- **R2.1** Workshop MUST expose `POST /api/qwen/hooks` that accepts Qwen Code's `http`-type hook payloads for events `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`.
- **R2.2** Hook events MUST be converted into synthetic spans and stitched into the existing `runs` table using `gen_ai.conversation.id` (from the hook payload's `conversation_id` field) as the join key.
- **R2.3** Hook span tree MUST be reconciled with OTLP span tree when both channels emit data for the same conversation (Qwen Code may use both — hooks fire alongside OTLP).

### R3. Persist source attribution

- **R3.1** `runs.source` MUST be a typed enum with values `"opencode" | "qwen_code" | "gigacode"`.
- **R3.2** Existing rows MUST default to `source='opencode'` (backward-compat).
- **R3.3** Source column MUST be indexed for fast filter.

### R4. UI: source-aware display

- **R4.1** `RunsPage` MUST show a «Source» badge per run with three distinct visual treatments (OpenCode / Qwen Code / GigaCode).
- **R4.2** `/api/facets` MUST expose `source` as a filterable facet.
- **R4.3** `SearchPage` MUST accept `?source=qwen_code` (and other values) as a filter.
- **R4.4** `RunDetail` header MUST show the source badge next to the existing `USER/CONVO/TRACE` chips.
- **R4.5** Source labels MUST be in `en.json` and `ru.json` (read via `useT()`).

### R5. Compatibility & extension

- **R5.1** Adding a new source (e.g. future SberCode v2) MUST require at most: one new entry in `SOURCE_VALUES`, one optional new adapter in `src/spans/adapters/`, one new mapping in `inferSource()`. **No** schema migration needed if column already exists.
- **R5.2** GigaCode MUST be accepted as a synonym for Qwen Code until validated otherwise (Kolya's explicit decision in scope-check Q2). If Qwen-compat assumption fails on corporate laptop, F-024 introduces a GigaCode-specific adapter without breaking existing data.

### R6. Hard constraints (inherited)

- **R6.1** This feature MUST NOT introduce any code paths for Codex / Claude Code / Anthropic / `@raindrop-ai/ai-sdk` / Anthropic-specific behaviour. `openspec/config.yaml` hard rule.
- **R6.2** This feature MUST NOT add cloud / SaaS hooks. Local `:5899` only.
- **R6.3** Daemon restart MUST NOT be performed by the agent (`openspec/config.yaml` hard rule). Code changes requiring restart must be proposed, not executed.

## Scenarios

### S1. Live Qwen Code session lands in Workshop DB

**Given** Kolya has Qwen Code installed with `glm` provider configured.
**And** Qwen Code `.qwen/settings.json` has:
```json
{
  "telemetry": {
    "enabled": true,
    "otlpEndpoint": "http://localhost:5899/v1/traces",
    "otlpProtocol": "http"
  },
  "hooks": {
    "PreToolUse": [{"hooks": [{"type": "http", "url": "http://localhost:5899/api/qwen/hooks", "timeout": 10}]}],
    "PostToolUse": [{"hooks": [{"type": "http", "url": "http://localhost:5899/api/qwen/hooks", "timeout": 10}]}],
    "Stop": [{"hooks": [{"type": "http", "url": "http://localhost:5899/api/qwen/hooks", "timeout": 10}]}]
  }
}
```

**When** Kolya runs `qwen "what files are in /tmp? list them and exit"` in his workshop repo.

**Then** Workshop DB has a new row in `runs` with `source='qwen_code'`, `status='finished'`.
**And** `spans` has ≥ 1 row with `span_type='LLM_GENERATION'` (the LLM call Qwen Code made to glm), `model='glm-*'`.
**And** `spans` has ≥ 1 row with `span_type='TOOL_CALL'` (the file listing), populated `input_payload` and `output_payload`.
**And** UI `RunsPage` shows the new run with a «Qwen Code» badge in teal.

### S2. Search filter by source

**Given** the DB has 10 OpenCode runs and 5 Qwen Code runs.

**When** Kolya opens `http://localhost:5899/search?source=qwen_code` in Workshop UI.

**Then** results show 5 runs, all with «Qwen Code» badge.
**And** no OpenCode runs are listed.

### S3. Sub-agent in Qwen Code session

**Given** Kolya's Qwen Code prompt includes a `@subagent` invocation (Qwen's subagent syntax).

**When** the session completes.

**Then** `spans` has ≥ 1 row with `span_type='AGENT_ROOT'`, name='qwen-code.subagent', attributes contain `gen_ai.agent.name='<subagent-name>'`.
**And** Workshop UI shows the sub-agent as a named nested block in `SpanTree`.

### S4. Hook-only ingestion (no OTLP)

**Given** Kolya disables OTLP (`telemetry.enabled=false`) but keeps hooks enabled.

**When** he runs the same prompt as S1.

**Then** `runs` row is still created (via hook `Stop` event).
**And** `spans` has tool-call spans (from `PreToolUse`/`PostToolUse`) but NO `LLM_GENERATION` span (because OTLP was disabled).
**And** UI shows the run as «partial telemetry — hooks only» in some indicator.

### S5. GigaCode session

**Given** GigaCode is installed and emits OTLP with `service.name='sandbox-agent'`.

**When** a GigaCode session runs.

**Then** `runs.source='gigacode'` in DB.
**And** UI badge shows «GigaCode» in gold.
**And** spans are normalized by the same adapters as Qwen Code.

### S6. Unknown / non-conformant OTLP source

**Given** an OTLP POST comes from a tool that has `service.name='some-other-cli'`.

**When** it hits `POST /v1/traces`.

**Then** `runs.source='opencode'` (safe default per Stage 1 M1.3).
**And** span tree is preserved as far as the existing adapters can normalize it.
**And** a warning is logged once per source name (rate-limited).

### S7. Hook payload malformed

**Given** `POST /api/qwen/hooks` receives a body that is not JSON, or JSON missing required fields (`hook_event`, `session_id`).

**When** the request is processed.

**Then** the endpoint returns `400 Bad Request` with a clear error message.
**And** no row is created in `runs` or `spans`.

## Open questions (to resolve during Stage 0)

- OQ1: Exact `qwen-code` stable tag to pin against.
- OQ2: Whether `gen_ai.conversation.id` is always present in Qwen Code hook payloads or only in OTLP. (Hook doc excerpt suggests both, but verify in live smoke.)
- OQ3: Whether `gen_ai.system_instructions` shape matches OTel SC exactly (a `[{type: "text", text: "..."}]` array) or Qwen Code uses a custom shape.
- OQ4: Token attribution for sub-agents — does Qwen Code stamp the sub-agent's tokens onto the subagent span or only on the inner LLM span? Affects StatsPanel accuracy.

## References

- `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md` — design / decisions / scope anchors.
- `openspec/config.yaml` — hard rules.
- `src/spans/normalize.ts` — adapter dispatcher.
- `src/parse.ts:148` — `parseOtlpRequest`.
- `src/db/schema.ts` — `runs`, `spans` tables.
- OTel GenAI SC: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/

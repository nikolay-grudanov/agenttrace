# F-023 — Multi-source ingestion research (Qwen Code + GigaCode)

> **Status:** Plan-only research doc. No code yet.
> **Author:** Miko (Hermes Agent). **Date:** 2026-09-17.

## Sources consulted

1. **Qwen Code** official docs:
   - `docs/developers/development/telemetry.md` (in `QwenLM/qwen-code` repo) — full span/attribute reference.
   - `qwenlm.github.io/qwen-code-docs/en/users/features/hooks/` — hook system reference.
   - DeepWiki mirror: `deepwiki.com/QwenLM/qwen-code/8.2-telemetry-and-observability`, `8.7-hooks-system`.
2. **GigaCode** — confirmed as Sberbank fork of Qwen Code (per Kolya's scope-check Q2). Not installed locally. Public docs unavailable; behaviour assumed identical to upstream Qwen Code until validated on corporate laptop.
3. **OpenTelemetry GenAI Semantic Conventions** — OTel spec: `opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/`. The standard the adapters target.
4. **Workshop codebase** — `src/parse.ts`, `src/spans/normalize.ts`, `src/spans/adapters/`, `src/db/schema.ts`.

## Qwen Code — span inventory

From `telemetry.md`, Qwen Code emits the following spans. Each row shows the span name, span type we'll assign, the OTel/Qwen attributes we expect, and the `NormalizedSpan` mapping.

### GenAI spans (LLM / Tool / Interaction / Agent)

| Span name (Qwen) | Qwen attrs | OTel GenAI-SC attrs | → `NormalizedSpan` | `span_type` |
|---|---|---|---|---|
| `qwen-code.api_request` | (none span-specific) | `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.request.*` | `{kind:"llm", model, messages, systemPrompt, providerOptions}` | `LLM_GENERATION` |
| `qwen-code.api_response` | `error`, `duration_ms`, `http.response.status_code` | `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.*` | same LLM view; status from `error` attr | `LLM_GENERATION` |
| `qwen-code.llm_request` | `duration_ms`, `error`, `error.type`, `model` | `gen_ai.request.model`, `gen_ai.usage.*` | same LLM view | `LLM_GENERATION` |
| `qwen-code.tool_call` | `function_name`, `decision`, `duration_ms`, `success`, `tool.call_id` | `gen_ai.tool.name`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | `{kind:"tool", name, args, result, resultIsError}` | `TOOL_CALL` |
| `qwen-code.tool.execution` | `duration_ms`, `success`, `execution_status`, `error`, `error_type` | `gen_ai.tool.name`, `tool.call_id` | `{kind:"tool", name, ...}` — execution-only metadata | `TOOL_CALL` |
| `qwen-code.tool.blocked_on_user` | `tool.name`, `decision`, `source` | — | `{kind:"tool", name, attributes:{decision, source, duration_ms}}` | `TOOL_CALL` (or INTERNAL — TBD) |
| `qwen-code.file_operation` | `function_name`, `duration_ms` | — | `{kind:"tool", name:"file_operation_<name>"}` | `TOOL_CALL` |
| `qwen-code.interaction` | `new_context` (when `includeSensitiveSpanAttributes=true`) | `gen_ai.input.messages` (one original user-text projection), `gen_ai.output.messages` (final answer) | `{kind:"agent", messages: [user→assistant], name: undefined}` | `AGENT_ROOT` |
| `qwen-code.subagent` | `qwen-code.subagent.id`, `qwen-code.subagent.name`, `qwen-code.subagent.invocation_kind` (foreground/fork/background), `qwen-code.subagent.is_built_in`, `qwen-code.subagent.depth`, `qwen-code.subagent.status`, `qwen-code.subagent.terminate_reason`, `qwen-code.subagent.duration_ms` | `gen_ai.operation.name` (always `invoke_agent`), `gen_ai.agent.name`, `gen_ai.agent.description`, `gen_ai.conversation.id`, `gen_ai.request.model` | `{kind:"agent", name, description, depth, parentSpanId: derived from conversation}` | `AGENT_ROOT` |
| `qwen-code.hook` | `hook_event` (PreToolUse/PostToolUse/PostToolUseFailure/PostToolBatch), `tool.name`, `duration_ms`, `success`, `should_proceed`, `should_stop`, `block_type`, `error` | — | `{kind:"other", attributes: {...hook metadata}}` | `INTERNAL` |

### Daemon spans

| Span name (Qwen) | Qwen attrs | → `NormalizedSpan` | `span_type` |
|---|---|---|---|
| `qwen-code.daemon.request` | `http.request.method`, `http.route`, `qwen-code.daemon.operation`, `http.response.status_code` | `{kind:"other"}` | `INTERNAL` |
| `qwen-code.daemon.bridge` | `qwen-code.daemon.operation` | `{kind:"other"}` | `INTERNAL` |

### Resource Metrics (not spans — log/metric pipeline)

These are NOT span events — they go through OTel metrics/logs channels. Workshop currently does not consume OTel metrics or logs (only spans). Out of scope for F-023:

- `qwen-code.memory.usage` (Histogram, bytes) — memory type
- `qwen-code.cpu.usage` (Histogram, percent)
- `qwen-code.file_operation` log event (overlaps with span name above)
- Resource attributes: `service.name`, `service.version`, `service.namespace`, `deployment.environment`, etc.

`service.name` is the discriminator we'll key on to detect Qwen Code / GigaCode.

## Qwen Code — Hook event shapes (HTTP-hook type)

From Qwen docs, hooks `http`-type receive the following JSON shapes on `POST /api/qwen/hooks`:

### `PreToolUse` event

```json
{
  "hook_event": "PreToolUse",
  "session_id": "ses_abc123",
  "conversation_id": "conv_xyz789",
  "tool_name": "run_shell_command",
  "tool_input": {"command": "ls -la"},
  "tool_use_id": "toolu_abc",
  "cwd": "/home/user/project",
  "transcript_path": "/path/to/transcript.json"
}
```

Workshop mapping: synthesize a `TOOL_CALL` span with `name=tool_name`, `input_payload=tool_input` (stringified), `end_time_ms=null` (in-flight).

### `PostToolUse` event

```json
{
  "hook_event": "PostToolUse",
  "session_id": "ses_abc123",
  "conversation_id": "conv_xyz789",
  "tool_name": "run_shell_command",
  "tool_input": {"command": "ls -la"},
  "tool_response": {"output": "file1\nfile2", "metadata": {...}},
  "tool_use_id": "toolu_abc",
  "duration_ms": 245
}
```

Workshop mapping: find the in-flight `PreToolUse` span by `(session_id, tool_use_id)` and close it with `output_payload=tool_response`, `status=OK`, `attributes.tool.duration_ms=duration_ms`. If `tool_response.error` is set → `status=ERROR`.

### `Stop` event

```json
{
  "hook_event": "Stop",
  "session_id": "ses_abc123",
  "conversation_id": "conv_xyz789",
  "stop_hook_active": false
}
```

Workshop mapping: close the root interaction span (created when the session was first seen), set `runs.status='finished'`. `stop_hook_active=true` means Qwen Code is in a stop-hook loop — log warning, do not close run.

### `SubagentStop` event

```json
{
  "hook_event": "SubagentStop",
  "session_id": "sub_ses_abc456",
  "conversation_id": "conv_xyz789",
  "subagent_name": "researcher-primary",
  "stop_hook_active": false
}
```

Workshop mapping: close the sub-agent's `AGENT_ROOT` span, set `attributes.subagent_name=subagent_name` (idempotent — already may have been set by OTLP). If the sub-agent span doesn't exist (pure-hook session), create it from scratch.

### Response shape (Workshop → Qwen Code)

For `PreToolUse` / `PostToolUse` hooks, Workshop can return:

```json
{"continue": true, "decision": "allow"}
```

To BLOCK a tool call:
```json
{"continue": false, "decision": "block", "reason": "blocked by workshop policy"}
```

For `Stop` hooks:
```json
{"continue": true}
```

To PREVENT stop:
```json
{"continue": false, "reason": "agent should continue: <reason>"}
```

**Decision (D-F023-1):** for F-023, Workshop always returns `{"continue": true}` — we are a passive debugger, not a policy engine. Future F-NNN could add blocking. This keeps the hook handler simple and avoids race conditions.

## GigaCode — assumptions

Per Kolya (scope-check Q2):
- GigaCode = Sberbank's fork of Qwen Code (not the unrelated crates.io `gigacode` package by Rivet).
- Not installed locally.
- Compatibility with Qwen Code is **assumed** for now; smoke test happens on corporate laptop.
- Receive same treatment as Qwen Code in F-023: `service.name="sandbox-agent"` (or whatever GigaCode sets) → `source='gigacode'` in DB, same adapters apply.

If assumption fails → F-024 introduces a GigaCode-specific adapter without breaking F-023 data.

## Adapter design

Following the existing pattern in `src/spans/normalize.ts`:

```ts
// src/spans/adapters/qwen.ts

export const qwenGenAiLlmAdapter: SpanAdapter = {
  name: "qwen-genai-llm",
  apply(input): AdapterMatch | null {
    if (input.spanType !== "LLM_GENERATION") return null;
    const inputMsgs = input.attrs["gen_ai.input.messages"];
    const outputMsgs = input.attrs["gen_ai.output.messages"];
    const systemInstr = input.attrs["gen_ai.system_instructions"];
    const model = input.attrs["gen_ai.request.model"] ?? input.attrs["gen_ai.response.model"];
    if (!inputMsgs && !outputMsgs && !systemInstr && !model) return null;  // not us

    const messages = parseGenAiMessages(inputMsgs, outputMsgs);
    const sys = extractSystemFromGenAi(systemInstr);
    const inputTokens = asNumber(input.attrs["gen_ai.usage.input_tokens"]);
    const outputTokens = asNumber(input.attrs["gen_ai.usage.output_tokens"]);

    return {
      inputPayload: stringifyIfNeeded(inputMsgs),
      outputPayload: stringifyIfNeeded(outputMsgs),
      normalized: {
        kind: "llm",
        messages,
        systemPrompt: sys,
        model,
        inputTokens,
        outputTokens,
      },
    };
  },
};

export const qwenGenAiToolAdapter: SpanAdapter = {
  name: "qwen-genai-tool",
  apply(input): AdapterMatch | null {
    if (input.spanType !== "TOOL_CALL") return null;
    const name = input.attrs["gen_ai.tool.name"];
    if (!name) return null;
    const argsRaw = input.attrs["gen_ai.tool.call.arguments"];
    const resultRaw = input.attrs["gen_ai.tool.call.result"];
    const errorMsg = input.attrs["otel.status.message"] as string | undefined;
    return {
      inputPayload: stringifyIfNeeded(argsRaw),
      outputPayload: stringifyIfNeeded(resultRaw) ?? errorMsg,
      normalized: {
        kind: "tool",
        name,
        args: parseJsonOrRaw(stringifyIfNeeded(argsRaw)),
        result: parseJsonOrRaw(stringifyIfNeeded(resultRaw) ?? errorMsg),
        resultIsError: !!errorMsg,
      },
    };
  },
};

export const qwenSubagentAdapter: SpanAdapter = {
  name: "qwen-subagent",
  apply(input): AdapterMatch | null {
    if (input.spanType !== "AGENT_ROOT") return null;
    const agentName =
      input.attrs["gen_ai.agent.name"] ??
      input.attrs["qwen-code.subagent.name"];
    if (!agentName) return null;
    const depth = asNumber(input.attrs["qwen-code.subagent.depth"]) ?? 0;
    const description = input.attrs["gen_ai.agent.description"] as string | undefined;
    const invocationKind = input.attrs["qwen-code.subagent.invocation_kind"] as string | undefined;
    const subagentId = input.attrs["qwen-code.subagent.id"] as string | undefined;
    return {
      normalized: {
        kind: "agent",
        name: agentName,
        description,
        depth,
        attributes: {
          ...(subagentId ? {"subagent_id": subagentId} : {}),
          ...(invocationKind ? {"invocation_kind": invocationKind} : {}),
        },
      },
    };
  },
};
```

`parseGenAiMessages()` handles the OTel GenAI-SC shape:
```ts
function parseGenAiMessages(inputMsgs: unknown, outputMsgs: unknown): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  if (typeof inputMsgs === "string") {
    try { inputMsgs = JSON.parse(inputMsgs); } catch { /* leave as-is */ }
  }
  if (Array.isArray(inputMsgs)) {
    for (const m of inputMsgs) {
      // shape: {role: "user"|"assistant"|"system"|"tool", parts: [{type:"text", text:"..."}]}
      const role = m.role ?? "user";
      const text = (m.parts ?? [])
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("");
      if (text) out.push({ role, content: text, raw: m });
    }
  }
  // similar for outputMsgs
  return out;
}
```

This shape comes straight from OTel GenAI-SC, so it should be stable across Qwen Code versions and any future tool that emits GenAI-SC spans.

## Schema migration (Stage 1 M1.2)

```sql
-- drizzle/0004_source.sql
ALTER TABLE runs ADD COLUMN source TEXT NOT NULL DEFAULT 'opencode';
ALTER TABLE spans ADD COLUMN source TEXT NOT NULL DEFAULT 'opencode';
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(source);
CREATE INDEX IF NOT EXISTS idx_spans_source ON spans(source);
```

Backward-compat: existing rows default to `'opencode'` (correct — they came from the OpenCode plugin).

The migration is **safely re-runnable** if wrapped in `IF NOT EXISTS` semantics. Drizzle's migration runner handles this — but the existing `drizzle/0002_fts5_spans.sql` doesn't use IF NOT EXISTS, so we follow the same pattern.

## Open questions (also listed in spec OQ1-OQ4)

- **OQ1**: Exact `qwen-code` stable tag — needs Kolya's pin.
- **OQ2**: `gen_ai.conversation.id` availability in hook payloads (vs OTLP only).
- **OQ3**: `gen_ai.system_instructions` shape match vs OTel SC.
- **OQ4**: Token attribution for sub-agents.

These are Stage 5 smoke-test items — resolve at live verification, document in `ai-docs/specs/F-023-live-smoke-recipe.md`.

## References (re-listed for cross-linking)

- `openspec/changes/archive/F-023-multi-source-ingestion/proposal.md`
- `openspec/specs/source-aware-ingestion/spec.md`
- `src/spans/normalize.ts`
- `src/parse.ts:148`
- `src/db/schema.ts`
- OTel GenAI SC: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/

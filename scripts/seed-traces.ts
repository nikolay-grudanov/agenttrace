#!/usr/bin/env tsx
/**
 * Seed a running raindrop workshop backend with a small library of representative
 * AI-agent traces. The fixtures are static and deterministic — re-running is
 * idempotent because run/span IDs don't change.
 *
 * Usage:
 *   bun run seed:traces                               # POSTs to http://localhost:5899
 *   AGENTTRACE_WORKSHOP_URL=http://localhost:5998 bun run seed:traces
 *
 * The fixtures are also exported so tests can import them directly instead of
 * going through HTTP.
 */


type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number };
type Attr = { key: string; value: AttrValue };

const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const int = (key: string, v: number): Attr => ({ key, value: { intValue: String(v) } });

// `AGENTTRACE_SEED_SALT` lets the smoke runner generate distinct trace IDs
// across consecutive seeds against the same DB. Default 0 keeps the legacy
// 0..0001 / 0..0002 / 0..0003 IDs that snapshot tests pin against.
const SALT = Number(process.env.AGENTTRACE_SEED_SALT ?? 0) || 0;
const traceId = (n: number) => (n + SALT).toString(16).padStart(32, "0");
const spanId = (trace: number, slot: number) =>
  `${(trace + SALT).toString(16).padStart(8, "0")}${slot.toString(16).padStart(8, "0")}`;
const nano = (ms: number) => String(BigInt(ms) * 1_000_000n);

interface SpanSeed {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  statusCode?: 1 | 2; // 1=OK, 2=ERROR
  attrs: Attr[];
}

function buildOtlpBody(tid: string, spans: SpanSeed[]) {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: spans.map((s) => ({
              traceId: tid,
              spanId: s.spanId,
              parentSpanId: s.parentSpanId,
              name: s.name,
              kind: 1,
              startTimeUnixNano: nano(s.startMs),
              endTimeUnixNano: nano(s.endMs),
              status: s.statusCode ? { code: s.statusCode } : undefined,
              attributes: s.attrs,
            })),
          },
        ],
      },
    ],
  };
}

// Common attributes that identify a run so the UI can group + filter
function runMeta(eventName: string, convoId: string, userId = "demo-user"): Attr[] {
  return [
    str("ai.telemetry.metadata.raindrop.eventName", eventName),
    str("ai.telemetry.metadata.raindrop.userId", userId),
    str("ai.telemetry.metadata.raindrop.convoId", convoId),
  ];
}

function llmAttrs(prompt: unknown, response: string, inTok: number, outTok: number): Attr[] {
  return [
    str("ai.operationId", "ai.generateText"),
    str("ai.model.id", "zai-coding-plan/glm-5.1"),
    str("ai.model.provider", "zai"),
    str("ai.prompt", JSON.stringify(prompt)),
    str("ai.response.text", response),
    int("ai.usage.inputTokens", inTok),
    int("ai.usage.outputTokens", outTok),
  ];
}

function toolAttrs(name: string, args: unknown, result: string): Attr[] {
  return [
    str("ai.operationId", "ai.toolCall"),
    str("ai.toolCall.name", name),
    str("ai.toolCall.args", JSON.stringify(args)),
    str("ai.toolCall.result", result),
  ];
}


// Pin the clock so re-running doesn't churn timestamps.
const T0 = 1_776_000_000_000;

/**
 * 1. Happy path — read a file, decide on an edit, apply the edit. Every span OK.
 */
function fixtureSuccessfulEdit() {
  const tid = traceId(1);
  const rt = spanId(1, 1);
  const meta = runMeta("code-agent", "demo-convo-readme");
  const t = T0;

  return {
    name: "successful edit",
    traceId: tid,
    body: buildOtlpBody(tid, [
      {
        spanId: rt, name: "agent.turn",
        startMs: t, endMs: t + 3200, statusCode: 1,
        attrs: [
          ...meta,
          str("traceloop.entity.input", "Fix the typo in README.md"),
          str("traceloop.entity.output", "Changed 'traec viewer' to 'trace viewer' on line 3."),
        ],
      },
      {
        spanId: spanId(1, 2), parentSpanId: rt, name: "llm.generate",
        startMs: t + 10, endMs: t + 480, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Fix the typo in README.md" }] },
            "I'll read the file first to find the typo.",
            42, 14,
          ),
        ],
      },
      {
        spanId: spanId(1, 3), parentSpanId: rt, name: "ai.toolCall",
        startMs: t + 495, endMs: t + 520, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs("read_file", { path: "README.md" }, "# Workshop\n\nA traec viewer for AI agents.\n"),
        ],
      },
      {
        spanId: spanId(1, 4), parentSpanId: rt, name: "llm.generate",
        startMs: t + 540, endMs: t + 1800, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Found 'traec' on line 3 — should be 'trace'." }] },
            "I'll apply the edit now.",
            88, 12,
          ),
        ],
      },
      {
        spanId: spanId(1, 5), parentSpanId: rt, name: "ai.toolCall",
        startMs: t + 1820, endMs: t + 1860, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs(
            "edit_file",
            { path: "README.md", old_string: "traec viewer", new_string: "trace viewer" },
            "edit applied",
          ),
        ],
      },
      {
        spanId: spanId(1, 6), parentSpanId: rt, name: "llm.generate",
        startMs: t + 1900, endMs: t + 3180, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "assistant", content: "edit applied" }] },
            "Fixed the typo on line 3. 'traec viewer' → 'trace viewer'.",
            110, 24,
          ),
        ],
      },
    ]),
  };
}

/**
 * 2. Tool failure + recovery — first bash invocation errors, agent reads the
 *    error, retries with a corrected command, finishes OK. Tests the UI's
 *    handling of mid-trace failures.
 */
function fixtureToolRecovery() {
  const tid = traceId(2);
  const rt = spanId(2, 1);
  const meta = runMeta("code-agent", "demo-convo-readme");
  const t = T0 + 5_000;

  return {
    name: "tool failure + recovery",
    traceId: tid,
    body: buildOtlpBody(tid, [
      {
        spanId: rt, name: "agent.turn",
        startMs: t, endMs: t + 2700, statusCode: 1,
        attrs: [
          ...meta,
          str("traceloop.entity.input", "Run the tests"),
          str("traceloop.entity.output", "Tests pass after switching from `npm test` to `pnpm test`."),
        ],
      },
      {
        spanId: spanId(2, 2), parentSpanId: rt, name: "llm.generate",
        startMs: t + 10, endMs: t + 420, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Run the tests" }] },
            "Running `npm test`.",
            30, 6,
          ),
        ],
      },
      {
        spanId: spanId(2, 3), parentSpanId: rt, name: "ai.toolCall",
        startMs: t + 440, endMs: t + 700, statusCode: 2,
        attrs: [
          ...meta,
          ...toolAttrs(
            "bash",
            { command: "npm test" },
            "npm error: This project uses pnpm. Use `pnpm test` instead.\nexit 1",
          ),
        ],
      },
      {
        spanId: spanId(2, 4), parentSpanId: rt, name: "llm.generate",
        startMs: t + 720, endMs: t + 1400, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "tool", content: "npm error: use pnpm instead" }] },
            "Switching to pnpm.",
            74, 7,
          ),
        ],
      },
      {
        spanId: spanId(2, 5), parentSpanId: rt, name: "ai.toolCall",
        startMs: t + 1420, endMs: t + 2200, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs(
            "bash",
            { command: "pnpm test" },
            "Test Files  8 passed (8)\nTests  48 passed (48)",
          ),
        ],
      },
      {
        spanId: spanId(2, 6), parentSpanId: rt, name: "llm.generate",
        startMs: t + 2220, endMs: t + 2680, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "tool", content: "8 test files, 48 tests passed" }] },
            "All 48 tests pass.",
            112, 9,
          ),
        ],
      },
    ]),
  };
}

/**
 * 3. Sub-agent — main agent spawns a code-review sub-agent, which itself spawns
 *    a nested lint sub-agent. Roots carry `ai.toolCall.name` so ingest classifies
 *    them TOOL_CALL, and each root's tool grandchild sits under its LLM child so
 *    detectSubAgents fires (TOOL_CALL > LLM > TOOL_CALL). Exercises drill-down.
 */
function fixtureSubAgent() {
  const tid = traceId(3);
  const rt = spanId(3, 1);
  const sub = spanId(3, 4);
  const meta = runMeta("code-agent", "demo-convo-review");
  const t = T0 + 10_000;

  return {
    name: "sub-agent review",
    traceId: tid,
    body: buildOtlpBody(tid, [
      {
        spanId: rt, name: "agent.turn",
        startMs: t, endMs: t + 4500, statusCode: 1,
        attrs: [
          ...meta,
          str("traceloop.entity.input", "Review the auth refactor in PR #42"),
          str("traceloop.entity.output", "LGTM — one minor nit about the retry loop in auth/session.ts:57."),
        ],
      },
      {
        spanId: spanId(3, 2), parentSpanId: rt, name: "llm.generate",
        startMs: t + 10, endMs: t + 600, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Review the auth refactor in PR #42" }] },
            "I'll grab the diff, then hand it to the reviewer agent.",
            38, 16,
          ),
        ],
      },
      {
        spanId: spanId(3, 3), parentSpanId: rt, name: "ai.toolCall",
        startMs: t + 620, endMs: t + 900, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs(
            "bash",
            { command: "git diff main...HEAD -- auth/" },
            "diff --git a/auth/session.ts b/auth/session.ts\n@@ -50,5 +50,10 @@\n+  // retry up to 3 times\n",
          ),
        ],
      },
      {
        spanId: sub, parentSpanId: rt, name: "subagent.review",
        startMs: t + 950, endMs: t + 4100, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.review"),
          str("subagent_name", "code-reviewer"),
          str("traceloop.entity.input", "Review this diff for auth/session.ts"),
          str("traceloop.entity.output", "LGTM, one nit at line 57."),
        ],
      },
      {
        spanId: spanId(3, 5), parentSpanId: sub, name: "llm.generate",
        startMs: t + 970, endMs: t + 2800, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Review this auth diff" }] },
            "Looking at the retry loop — no exponential backoff.",
            220, 18,
          ),
        ],
      },
      {
        spanId: spanId(3, 6), parentSpanId: spanId(3, 5), name: "ai.toolCall",
        startMs: t + 2820, endMs: t + 2980, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs(
            "read_file",
            { path: "auth/session.ts", start_line: 40, end_line: 70 },
            "50: function connect() {\n57:   for (let i = 0; i < 3; i++) { ... }\n",
          ),
        ],
      },
      {
        spanId: spanId(3, 7), parentSpanId: sub, name: "llm.generate",
        startMs: t + 3000, endMs: t + 4080, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "tool", content: "session.ts:57 retry loop" }] },
            "LGTM. Nit at span_id: 0000000300000006 — consider backoff.",
            310, 22,
          ),
        ],
      },
      {
        // Nested sub-agent: the reviewer delegates linting one level deeper.
        // Parented under llm 3,7 so the reviewer root satisfies TOOL > LLM > TOOL.
        spanId: spanId(3, 9), parentSpanId: spanId(3, 7), name: "subagent.lint",
        startMs: t + 3100, endMs: t + 4000, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.lint"),
          str("subagent_name", "lint-checker"),
          str("traceloop.entity.input", "Lint auth/session.ts"),
          str("traceloop.entity.output", "0 errors, 1 warning (unused import)."),
        ],
      },
      {
        spanId: spanId(3, 10), parentSpanId: spanId(3, 9), name: "llm.generate",
        startMs: t + 3150, endMs: t + 3550, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "user", content: "Lint auth/session.ts" }] },
            "Running eslint on the changed file.",
            90, 11,
          ),
        ],
      },
      {
        spanId: spanId(3, 11), parentSpanId: spanId(3, 10), name: "ai.toolCall",
        startMs: t + 3600, endMs: t + 3900, statusCode: 1,
        attrs: [
          ...meta,
          ...toolAttrs(
            "bash",
            { command: "eslint auth/session.ts" },
            "1:1 warning unused-import 'crypto'",
          ),
        ],
      },
      {
        spanId: spanId(3, 8), parentSpanId: rt, name: "llm.generate",
        startMs: t + 4130, endMs: t + 4480, statusCode: 1,
        attrs: [
          ...meta,
          ...llmAttrs(
            { messages: [{ role: "tool", content: "reviewer: LGTM with one nit" }] },
            "Review done. LGTM with a small note about retry backoff.",
            420, 14,
          ),
        ],
      },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Fixture 4: parallel sub-agents + 3-level nesting.
//
// Coverage:
//   - PARALLEL: the parent turn fans out 3 sibling sub-agents
//     (test-writer, security-auditor, doc-updater) whose time intervals
//     overlap. The UI's FlameTimeline must show 3 gold bands stacked.
//   - NESTED 2: test-writer itself spawns 2 parallel helpers
//     (jest-runner, coverage-reporter).
//   - NESTED 3: coverage-reporter spawns a single lcov-parser one level
//     deeper. Proves Pattern 1 + 3 hold across arbitrary depth.
//
// All sub-agent roots carry `ai.toolCall.name` (Pattern 1 anchor) AND
// `subagent_name` (display label).
// ---------------------------------------------------------------------------
function fixtureParallelNested() {
  const tid = traceId(4);
  const rt = spanId(4, 1);
  const w  = spanId(4, 2); // test-writer
  const s  = spanId(4, 3); // security-auditor
  const d  = spanId(4, 4); // doc-updater
  const wj = spanId(4, 5); // jest-runner (under test-writer)
  const wc = spanId(4, 6); // coverage-reporter (under test-writer)
  const cl = spanId(4, 7); // lcov-parser (under coverage-reporter, depth 3)
  const meta = runMeta("code-agent", "demo-convo-pr77");
  const t = T0 + 20_000;

  return {
    name: "parallel + 3-level nested",
    traceId: tid,
    body: buildOtlpBody(tid, [
      {
        spanId: rt, name: "agent.turn",
        startMs: t, endMs: t + 6000, statusCode: 1,
        attrs: [
          ...meta,
          str("traceloop.entity.input", "Add tests, audit security, update README for PR #77"),
          str("traceloop.entity.output", "All three agents done. Tests green, no vulns, README updated."),
        ],
      },
      {
        spanId: spanId(4, 8), parentSpanId: rt, name: "llm.generate",
        startMs: t + 10, endMs: t + 400, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Add tests, audit security, update README" }] },
          "Spawning 3 sub-agents in parallel.", 42, 18,
        )],
      },
      // ---- Sub-agent 1: test-writer (parallel) -----------------------------
      {
        spanId: w, parentSpanId: rt, name: "subagent.test",
        startMs: t + 500, endMs: t + 3500, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.test"),
          str("subagent_name", "test-writer"),
          str("traceloop.entity.input", "Write Jest tests for PR #77"),
          str("traceloop.entity.output", "12 tests passing."),
        ],
      },
      {
        spanId: spanId(4, 9), parentSpanId: w, name: "llm.generate",
        startMs: t + 520, endMs: t + 1800, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Write tests for auth/session.ts" }] },
          "I'll generate test stubs, then run them.", 180, 32,
        )],
      },
      // test-writer -> jest-runner (depth 2, parallel with coverage-reporter)
      {
        spanId: wj, parentSpanId: spanId(4, 9), name: "subagent.jest",
        startMs: t + 1900, endMs: t + 2700, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.jest"),
          str("subagent_name", "jest-runner"),
          str("traceloop.entity.input", "Run jest --testPathPattern=auth/session"),
          str("traceloop.entity.output", "12 passed, 0 failed"),
        ],
      },
      {
        spanId: spanId(4, 10), parentSpanId: wj, name: "llm.generate",
        startMs: t + 1920, endMs: t + 2680, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Run the test suite" }] },
          "Executing tests...", 60, 8,
        )],
      },
      // test-writer -> coverage-reporter (depth 2, parallel with jest-runner)
      {
        spanId: wc, parentSpanId: spanId(4, 9), name: "subagent.coverage",
        startMs: t + 1900, endMs: t + 3400, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.coverage"),
          str("subagent_name", "coverage-reporter"),
          str("traceloop.entity.input", "Generate coverage report for PR #77"),
          str("traceloop.entity.output", "Coverage: 87.3% lines, 79.1% branches"),
        ],
      },
      {
        spanId: spanId(4, 11), parentSpanId: wc, name: "llm.generate",
        startMs: t + 1920, endMs: t + 3380, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Compute coverage" }] },
          "Need an lcov summary first.", 90, 14,
        )],
      },
      // coverage-reporter -> lcov-parser (DEPTH 3 — proves nesting survives)
      {
        spanId: cl, parentSpanId: spanId(4, 11), name: "subagent.lcov",
        startMs: t + 2700, endMs: t + 3200, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.lcov"),
          str("subagent_name", "lcov-parser"),
          str("traceloop.entity.input", "Parse coverage/lcov.info"),
          str("traceloop.entity.output", "Parsed 47 files."),
        ],
      },
      {
        spanId: spanId(4, 12), parentSpanId: cl, name: "llm.generate",
        startMs: t + 2720, endMs: t + 3180, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Parse lcov" }] },
          "Tokens aggregated.", 30, 5,
        )],
      },
      {
        spanId: spanId(4, 13), parentSpanId: w, name: "llm.generate",
        startMs: t + 3450, endMs: t + 3480, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "tool", content: "tests + coverage OK" }] },
          "All tests passing.", 50, 6,
        )],
      },
      // ---- Sub-agent 2: security-auditor (parallel) ------------------------
      {
        spanId: s, parentSpanId: rt, name: "subagent.audit",
        startMs: t + 500, endMs: t + 2800, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.audit"),
          str("subagent_name", "security-auditor"),
          str("traceloop.entity.input", "Audit PR #77 for CVEs"),
          str("traceloop.entity.output", "No vulnerabilities found."),
        ],
      },
      {
        spanId: spanId(4, 14), parentSpanId: s, name: "llm.generate",
        startMs: t + 520, endMs: t + 2780, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Scan for security issues" }] },
          "Running npm audit + semgrep.", 240, 22,
        )],
      },
      // ---- Sub-agent 3: doc-updater (parallel) -----------------------------
      {
        spanId: d, parentSpanId: rt, name: "subagent.docs",
        startMs: t + 500, endMs: t + 2200, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.docs"),
          str("subagent_name", "doc-updater"),
          str("traceloop.entity.input", "Update README with PR #77 changes"),
          str("traceloop.entity.output", "README updated, +18/-4 lines."),
        ],
      },
      {
        spanId: spanId(4, 15), parentSpanId: d, name: "llm.generate",
        startMs: t + 520, endMs: t + 2180, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "Update README" }] },
          "Edited sections 3 and 5.", 110, 18,
        )],
      },
      {
        spanId: spanId(4, 16), parentSpanId: rt, name: "llm.generate",
        startMs: t + 5400, endMs: t + 5980, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "tool", content: "all 3 agents done" }] },
          "Synthesising: tests green, no vulns, README updated.", 80, 14,
        )],
      },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Fixture 5: REAL glm-5.1 response captured live (2026-07-22, run8.log).
//
// Faithfully replays what our plugin v0.1.0-kolya.7 would emit in production:
//   - parent turn asks the LLM to delegate 2 parallel sub-agents
//   - LLM spawns "analyst" (general distribution tracing summary, 2 sentences)
//   - LLM spawns "reviewer" (3 OpenTelemetry benefits, bullet list)
//   - LLM synthesises everything into one paragraph
//
// All four sub-agent roots carry the F-003 attribute contract:
//   - ai.toolCall.name        ("subagent.analyst" / "subagent.reviewer")
//   - subagent_name           ("analyst" / "reviewer")
//   - traceloop.entity.input  (short human description, like args.description)
//
// The two real texts are pasted verbatim from /tmp/oc-f003-smoke/run8.log so
// the UI shows "as if the production plugin shipped them" without depending
// on the local OpenCode 1.17.x built-in plugin handing off to Workshop.
// ---------------------------------------------------------------------------
function fixtureRealGlm() {
  const tid = traceId(5);
  const rt = spanId(5, 1);
  const a  = spanId(5, 2); // analyst
  const r  = spanId(5, 3); // reviewer
  const meta = runMeta("code-agent", "demo-convo-pr77-reveal");
  const t = T0 + 30_000;

  return {
    name: "real glm-5.1 (parallel delegations)",
    traceId: tid,
    body: buildOtlpBody(tid, [
      {
        spanId: rt, name: "agent.turn",
        startMs: t, endMs: t + 4800, statusCode: 1,
        attrs: [
          ...meta,
          str("traceloop.entity.input",
            "Use the task tool to spawn exactly 2 parallel sub-agents with descriptions: "
            + "(1) 'analyst' explains in 2 sentences what distributed tracing is, "
            + "(2) 'reviewer' lists 3 benefits of OpenTelemetry. "
            + "Use ONLY the task tool."),
          str("traceloop.entity.output", "Synthesis paragraph emitted by glm-5.1 — see below."),
        ],
      },
      {
        spanId: spanId(5, 8), parentSpanId: rt, name: "llm.generate",
        startMs: t + 10, endMs: t + 380, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "spawn 2 parallel sub-agents" }] },
          "I'll spawn both sub-agents in parallel now.", 42, 18,
        )],
      },
      // --- Sub-agent 1: analyst (real glm-5.1 output) -----------------------
      {
        spanId: a, parentSpanId: rt, name: "subagent.analyst",
        startMs: t + 500, endMs: t + 2400, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.analyst"),
          str("subagent_name", "analyst"),
          str("traceloop.entity.input", "Explain in 2 sentences what distributed tracing is."),
          str("traceloop.entity.output",
            "Distributed tracing is an observability technique that follows a single "
            + "request as it moves across multiple services in a distributed system, "
            + "recording each step as a span and stitching them into an end-to-end trace "
            + "that reveals timing, errors, and causal relationships. "
            + "OpenTelemetry makes implementing this practice far easier: "
            + "it is a vendor-neutral, CNCF-backed standard that prevents lock-in "
            + "by letting you swap backends without re-instrumenting; "
            + "it unifies traces, metrics, and logs under a single API/SDK; "
            + "and it offers rich auto-instrumentation libraries that capture data "
            + "with minimal code changes."),
        ],
      },
      {
        spanId: spanId(5, 9), parentSpanId: a, name: "llm.generate",
        startMs: t + 520, endMs: t + 2380, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "What is distributed tracing?" }] },
          "Distributed tracing is an observability technique...", 240, 22,
        )],
      },
      // --- Sub-agent 2: reviewer (real glm-5.1 output) ----------------------
      {
        spanId: r, parentSpanId: rt, name: "subagent.reviewer",
        startMs: t + 500, endMs: t + 2700, statusCode: 1,
        attrs: [
          ...meta,
          str("ai.toolCall.name", "subagent.reviewer"),
          str("subagent_name", "reviewer"),
          str("traceloop.entity.input", "List 3 benefits of using OpenTelemetry."),
          str("traceloop.entity.output",
            "1) Vendor-neutral instrumentation standard \u2014 avoids lock-in to any "
            + "single observability backend. 2) Unified API across traces, metrics, "
            + "and logs \u2014 one SDK, three signal types, consistent semantics. "
            + "3) Rich auto-instrumentation libraries for popular languages and "
            + "frameworks \u2014 minimal code changes to start emitting telemetry."),
        ],
      },
      {
        spanId: spanId(5, 10), parentSpanId: r, name: "llm.generate",
        startMs: t + 520, endMs: t + 2680, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "user", content: "List 3 OTel benefits" }] },
          "Three concrete benefits: 1) vendor-neutral, 2) unified API, 3) auto-instrumentation...", 180, 14,
        )],
      },
      // --- Parent turn receives both results and synthesises (parallel) ----
      {
        spanId: spanId(5, 11), parentSpanId: rt, name: "llm.generate",
        startMs: t + 4400, endMs: t + 4780, statusCode: 1,
        attrs: [...meta, ...llmAttrs(
          { messages: [{ role: "tool", content: "both sub-agents done" }] },
          "Distributed tracing tracks a single request as it moves across multiple "
          + "services in a distributed system, recording timing, context, and metadata "
          + "at each hop under a shared trace ID so engineers can see the end-to-end "
          + "journey and pinpoint bottlenecks. OpenTelemetry complements this practice "
          + "by providing a vendor-neutral, unified standard for instrumenting traces, "
          + "metrics, and logs\u2014letting teams write telemetry once and export to any "
          + "backend\u2014while its broad CNCF-backed ecosystem ensures compatibility "
          + "across languages, frameworks, and platforms. Together, they form a cohesive "
          + "observability foundation: the methodology to understand request flow and "
          + "the tooling to implement it consistently across an entire stack.",
          290, 36,
        )],
      },
    ]),
  };
}

const FIXTURES = [
  fixtureSuccessfulEdit,
  fixtureToolRecovery,
  fixtureSubAgent,
  fixtureParallelNested,
  fixtureRealGlm,
];


async function main() {
  const url = process.env.AGENTTRACE_WORKSHOP_URL ?? "http://localhost:5899";
  console.log(`→ seeding ${FIXTURES.length} traces to ${url}`);
  for (const make of FIXTURES) {
    const fx = make();
    const res = await fetch(`${url}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fx.body),
    });
    if (!res.ok) {
      console.error(`✗ ${fx.name}: ${res.status} ${await res.text()}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ ${fx.name.padEnd(26)} traceId=${fx.traceId}`);
  }
  console.log(`\nOpen ${url} to see them in the runs list.`);
}

// Only run main when invoked directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

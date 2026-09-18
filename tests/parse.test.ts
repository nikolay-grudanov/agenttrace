/**
 * Tests for src/parse.ts — OTLP span ingestion.
 *
 * F-027 acceptance test lives here: a span payload carrying
 * `gen_ai.usage.prompt_tokens=42` and `gen_ai.usage.completion_tokens=17`
 * (the bare-form aliases used by some GenAI SDKs like Google ADK and parts
 * of OpenLLMetry) must surface as `input_tokens: 42` / `output_tokens: 17`
 * on the parsed ParsedSpan.
 *
 * Precedence test (F-027): when both the legacy `gen_ai.usage.input_tokens`
 * and the new `gen_ai.usage.prompt_tokens` are present, the legacy form
 * still wins — matches upstream commit `10f2161` behaviour (new alias is
 * appended last, so `first()` resolution is unchanged for SDKs that already
 * used the `*_input_tokens` form).
 */

import { describe, expect, test } from "bun:test";
import { parseOtlpRequest } from "../src/parse";

// Minimal valid OTLP envelope carrying a single LLM_GENERATION span.
// `gen_ai.operation.name=chat` + presence of indexed `gen_ai.prompt.*` /
// `gen_ai.completion.*` attrs drives `inferSpanType` to LLM_GENERATION;
// we set `gen_ai.request.model` so the model field is also resolved
// (orthogonal to this test — kept so the parser doesn't take an unrelated
// fallback path on a future refactor).
function buildOtlp(
  attrs: Array<{ key: string; value: { intValue?: string; stringValue?: string } }>,
  spanName = "chat",
): any {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: "0".repeat(32),
                spanId: "0".repeat(15) + "1",
                name: spanName,
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000001000000000",
                attributes: [
                  // Promote the span to LLM_GENERATION via Traceloop-style kind.
                  { key: "traceloop.span.kind", value: { stringValue: "llm" } },
                  // Avoid `traceloop.entity.input`/`output` being asserted
                  // by future refactors: this span is intentionally
                  // minimal — only the token attrs under test.
                  ...attrs,
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("parseOtlpRequest — F-027 token alias expansion", () => {
  test("gen_ai.usage.prompt_tokens / completion_tokens surface as input_tokens / output_tokens", () => {
    const otlp = buildOtlp([
      { key: "gen_ai.usage.prompt_tokens", value: { intValue: "42" } },
      { key: "gen_ai.usage.completion_tokens", value: { intValue: "17" } },
    ]);

    const [span] = parseOtlpRequest(otlp);
    expect(span).toBeDefined();
    expect(span.inputTokens).toBe(42);
    expect(span.outputTokens).toBe(17);
  });

  test("legacy gen_ai.usage.input_tokens / output_tokens still resolve (precedence unchanged)", () => {
    const otlp = buildOtlp([
      { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
      { key: "gen_ai.usage.output_tokens", value: { intValue: "200" } },
    ]);

    const [span] = parseOtlpRequest(otlp);
    expect(span.inputTokens).toBe(100);
    expect(span.outputTokens).toBe(200);
  });

  test("legacy attribute wins when both legacy and new alias are present", () => {
    // Verifies the alias was appended LAST in the `first(...)` chain —
    // so SDKs already emitting the legacy form keep their numbers and
    // we don't accidentally override their values with a sibling attr
    // a downstream tool happened to set.
    const otlp = buildOtlp([
      { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
      { key: "gen_ai.usage.prompt_tokens", value: { intValue: "42" } },
      { key: "gen_ai.usage.output_tokens", value: { intValue: "200" } },
      { key: "gen_ai.usage.completion_tokens", value: { intValue: "17" } },
    ]);

    const [span] = parseOtlpRequest(otlp);
    expect(span.inputTokens).toBe(100);
    expect(span.outputTokens).toBe(200);
  });
});
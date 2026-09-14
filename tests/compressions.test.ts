import { describe, expect, test } from "bun:test";

const dbPath = `/tmp/f021-compressions-${process.pid}.db`;
process.env.RAINDROP_WORKSHOP_DB_PATH = dbPath;
const { detectCompressions } = await import("../src/agents");
const { getDrizzleDb, insertSpan, getConvoCompressions } = await import("../src/db");

function span(p: Partial<Parameters<typeof detectCompressions>[0][number]> & { id: string }) {
  return {
    parent_span_id: null,
    name: "span",
    span_type: "TOOL_CALL",
    start_time_ms: 0,
    end_time_ms: 100,
    duration_ms: 100,
    model: null,
    status: "OK",
    input_tokens: null,
    output_tokens: null,
    ...p,
  } as Parameters<typeof detectCompressions>[0][number];
}

const COMPRESS_INPUT = JSON.stringify({
  topic: "DCP Smoke Test",
  content: [{ startId: "m0001", endId: "m0003", summary: "Read note.txt twice; missing-file.txt errored." }],
});
const NOTIFICATION_MSGS = JSON.stringify([
  { role: "user", content: "▣ DCP | -291 removed, +120 summary\n\n▣ Compression #1 -214 removed, +120 summary · 3 messages and 2 tools compressed" },
]);

describe("detectCompressions (pure)", () => {
  test("extracts topic, blocks and joins notification stats by #N", () => {
    const out = detectCompressions([
      span({ id: "llm1", name: "llm.generate", span_type: "LLM_GENERATION", input_payload: NOTIFICATION_MSGS, start_time_ms: 0 }),
      span({ id: "c1", name: "compress", span_type: "TOOL_CALL", input_payload: COMPRESS_INPUT, output_payload: '"Compressed 3 messages into [Compressed conversation section]."', start_time_ms: 50, duration_ms: 186 }),
    ]);
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.index).toBe(1);
    expect(c.topic).toBe("DCP Smoke Test");
    expect(c.blocks[0].start_id).toBe("m0001");
    expect(c.blocks[0].end_id).toBe("m0003");
    expect(c.messages_compressed).toBe(3);
    expect(c.tools_compressed).toBe(2);
    expect(c.removed_tokens).toBe(214);
    expect(c.summary_tokens).toBe(120);
  });

  test("non-dcp compress payload (no content blocks) is ignored", () => {
    const out = detectCompressions([
      span({ id: "c9", name: "compress", span_type: "TOOL_CALL", input_payload: JSON.stringify({ target: "assets.zip" }) }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("sequential indices follow chronological order across runs", () => {
    const mk = (id: string, t: number) =>
      span({ id, name: "compress", span_type: "TOOL_CALL", run_id: `run-${id}`, input_payload: COMPRESS_INPUT, start_time_ms: t });
    const out = detectCompressions([mk("late", 500), mk("early", 100)]);
    expect(out.map(c => [c.index, c.span_id])).toEqual([[1, "early"], [2, "late"]]);
  });

  test("missing notification degrades to payload-only stats", () => {
    const out = detectCompressions([
      span({ id: "c1", name: "compress", span_type: "TOOL_CALL", input_payload: COMPRESS_INPUT, output_payload: '"Compressed 5 messages into [Compressed conversation section]."' }),
    ]);
    expect(out[0].removed_tokens).toBeNull();
    expect(out[0].summary_tokens).toBeNull();
    expect(out[0].messages_compressed).toBe(5);
  });
});

describe("getConvoCompressions (db)", () => {
  const db = getDrizzleDb();
  db.$client.run(
    "INSERT INTO runs (id,started_at,last_updated_at,convo_id) VALUES (?, ?, ?, ?)",
    ["f021-run", 1, 1, "f021-convo"],
  );
  db.$client.run(
    "INSERT INTO runs (id,started_at,last_updated_at,convo_id) VALUES (?, ?, ?, ?)",
    ["f021-run2", 2, 2, "other-convo"],
  );
  insertSpan({ id: "f021-llm", run_id: "f021-run", name: "llm.generate", span_type: "LLM_GENERATION", model: "gpt-x", status: "OK", input_payload: NOTIFICATION_MSGS, output_payload: "", start_time_ms: 10, end_time_ms: 40, duration_ms: 30 });
  insertSpan({ id: "f021-c1", run_id: "f021-run", name: "compress", span_type: "TOOL_CALL", status: "OK", input_payload: COMPRESS_INPUT, output_payload: '"Compressed 3 messages into [Compressed conversation section]."', start_time_ms: 50, end_time_ms: 236, duration_ms: 186 });

  test("aggregates totals across the convo's runs only", () => {
    const report = getConvoCompressions("f021-convo");
    expect(report.total).toBe(1);
    expect(report.totals.removed_tokens).toBe(214);
    expect(report.totals.summary_tokens).toBe(120);
    expect(report.totals.net_tokens).toBe(94);
    expect(report.totals.messages).toBe(3);
    expect(report.totals.tools).toBe(2);
    expect(report.compressions[0].run_id).toBe("f021-run");
  });

  test("empty convo returns zeroed report", () => {
    const report = getConvoCompressions("no-such-convo");
    expect(report.total).toBe(0);
    expect(report.compressions).toHaveLength(0);
  });
});

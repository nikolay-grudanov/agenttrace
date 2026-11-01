import { describe, expect, test } from "bun:test";

const dbPath = `/tmp/f008-search-${process.pid}.db`;
process.env.RAINDROP_WORKSHOP_DB_PATH = dbPath;
const { getDrizzleDb, insertSpan, searchSpans, closeDb } = await import("../src/db");

// `src/db.ts` caches its SQLite handle in a module-level singleton, and Bun
// runs every test file in ONE process (same `process.pid`). Without this
// reset, the first test file to touch the DB wins the cached path and every
// later file writes into the previous file's database — so `search-api` would
// see `compressions`' TOOL_CALL spans and its `spanType` counts would be off.
closeDb();

const db = getDrizzleDb();
db.$client.run("INSERT INTO runs (id,started_at,last_updated_at,convo_id) VALUES (?, ?, ?, ?)", ["search-run", 1, 1, "search-convo"]);
insertSpan({ id: "search-span", run_id: "search-run", name: "think_think", span_type: "TOOL_CALL", model: "MiniMax-M3", status: "OK", input_payload: "Connection refused", output_payload: "HTTP 500", start_time_ms: 1, end_time_ms: 2, duration_ms: 1 });

describe("searchSpans", () => {
  test("returns matching FTS rows with snippets", () => {
    const result = searchSpans("connection");
    expect(result.total).toBe(1);
    expect(result.results[0].span_id).toBe("search-span");
    expect(String((result.results[0] as { snippet: unknown }).snippet).toLowerCase()).toContain("&lt;mark&gt;connection&lt;/mark&gt;");
  });

  test("supports pagination", () => {
    expect(searchSpans("connection", { limit: 1, offset: 1 }).results).toHaveLength(0);
  });

  test("empty query returns no matches", () => {
    expect(searchSpans("   ").total).toBe(0);
  });
});

describe("searchSpans filters", () => {
  test("filters by agent event_name", () => {
    db.$client.run("UPDATE runs SET event_name = ? WHERE id = ?", ["code-agent", "search-run"]);
    db.$client.run("INSERT INTO runs (id,started_at,last_updated_at,convo_id,event_name) VALUES (?, ?, ?, ?, ?)", ["other-run", 1, 1, "other", "diagram-agent"]);
    db.$client.run(`INSERT INTO spans_fts (span_id, run_id, convo_id, span_name, span_type, model, content_text) VALUES ('other-span','other-run','other','llm.generate','LLM_GENERATION','MiniMax-M3','hydration test')`);
    const result = searchSpans("hydration", { agent: "code-agent" });
    expect(result.total).toBe(0);
    const matched = searchSpans("connection", { agent: "code-agent" });
    expect(matched.total).toBe(1);
  });

  test("filters by git project/branch/commit", () => {
    db.$client.run("UPDATE runs SET metadata = ? WHERE id = ?", [JSON.stringify({ git: { project: "opencode-workshop", branch: "main", commit: "abc123" } }), "other-run"]);
    const proj = searchSpans("hydration", { project: "opencode-workshop" });
    expect(proj.total).toBe(1);
    const missing = searchSpans("hydration", { project: "no-such-project" });
    expect(missing.total).toBe(0);
    const commit = searchSpans("hydration", { commit: "abc" });
    expect(commit.total).toBe(1);
  });

  test("returns facets for client-side suggestions", async () => {
    const { computeFacets } = await import("../src/db");
    const facets = computeFacets();
    expect(facets.agents).toContain("code-agent");
    expect(facets.agents).toContain("diagram-agent");
    expect(facets.projects).toContain("opencode-workshop");
    expect(facets.branches).toContain("main");
  });

  test("filters by model", () => {
    expect(searchSpans("hydration", { model: "MiniMax-M3" }).total).toBe(1);
    expect(searchSpans("hydration", { model: "NoSuchModel" }).total).toBe(0);
  });
});

describe("searchSpans filter-only (empty q)", () => {
  test("agent filter matches without free-text", () => {
    const result = searchSpans("", { agent: "code-agent" });
    expect(result.total).toBe(1);
    expect(result.results[0].span_id).toBe("search-span");
    expect(result.results[0].event_name).toBe("code-agent");
    expect(searchSpans("", { agent: "no-such-agent" }).total).toBe(0);
  });

  test("span name / type / model filters work without free-text", () => {
    expect(searchSpans("", { spanName: "think_think" }).total).toBe(1);
    expect(searchSpans("", { spanType: "TOOL_CALL" }).total).toBe(1);
    // spans_fts-only rows (no `spans` counterpart) are invisible to the
    // filter-only scan — model filter matches search-span, not other-span.
    expect(searchSpans("", { model: "MiniMax-M3" }).total).toBe(1);
    expect(searchSpans("", { model: "NoSuchModel" }).total).toBe(0);
  });

  test("hasErrors filter works without free-text", () => {
    insertSpan({ id: "err-span", run_id: "search-run", name: "bash", span_type: "TOOL_CALL", model: "MiniMax-M3", status: "ERROR", input_payload: "boom", output_payload: "", start_time_ms: 2, end_time_ms: 3, duration_ms: 1 });
    expect(searchSpans("", { hasErrors: true }).total).toBe(1);
    expect(searchSpans("", { hasErrors: true, spanName: "bash" }).total).toBe(1);
    expect(searchSpans("", { hasErrors: true, spanName: "think_think" }).total).toBe(0);
  });

  test("date range filter works without free-text", () => {
    const result = searchSpans("", { agent: "code-agent", dateFrom: "1970-01-01", dateTo: "1970-01-02" });
    expect(result.total).toBe(2);
    // recency order: err-span (start_time_ms=2) before search-span (1)
    expect(result.results[0].span_id).toBe("err-span");
    expect(result.results[1].span_id).toBe("search-span");
  });

  test("empty query and no filters still returns empty", () => {
    expect(searchSpans("").total).toBe(0);
  });
});

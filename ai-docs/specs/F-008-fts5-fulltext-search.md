# F-008 — SQLite FTS5 Full-Text Search Across Spans

> **Status:** Planning spec. Roadmap Tier 1 (next-up). Not yet implemented.
> **Author:** Miko (Hermes Agent) for Kolya Gruanov, 2026-09-04.
> **Repo:** `~/workspase/projects/agenttrace` (local debugger fork of `raindrop-ai/workshop`).
> **Estimated effort:** 3-5 days (1 senior dev, single context).
> **Commits target:** 3-4 atomic commits, like F-005/F-012 style.

---

## 1. Problem statement

### Current state (2026-09-04)
Workshop's search box in the run list (`app/src/components/SearchBox.tsx` or equivalent — to be confirmed in `app/src/`) only matches against:

- `runs.event_name` (e.g., `"opencode_session"`, `"f010-mcp"`)
- `runs.id` prefix (run id substring)
- `runs.convo_id` (rare)

It does **NOT** match:

- Span names (e.g., "task", "Subagent", "Tool: read_file")
- Tool call args (e.g., `"GET /v1/models"`, `"file_path": "src/db.ts"`)
- LLM message text (system/user/assistant content)
- Tool result text (MCP responses, file contents)
- Span attributes (model name, provider URL)

### Why it hurts

Every debugging session looks like this:

> "Where did my LLM say 'Connection refused'?"
> "Show me every tool call that returned HTTP 500 in the last 24h."
> "Find the span where I passed `subagent_type: research`."

Today this is **impossible without grep'ing the SQLite DB by hand** (`sqlite3 ~/.raindrop/raindrop_workshop.db ".schema"` then write your own SQL). The UI search returns empty.

### Concrete example

Run `4cc39c8b` (think-mcp test) has 3 spans. One of them is `think_think` from the think-mcp server. Today you can find that run by event name `"opencode_session"`, but you cannot search by the **string content of the think span's output** (`"Let me think about this..."`).

If you want to find "where did I ask the agent to think about raindrop collection", you can't.

---

## 2. Goal (in one line)

Make every word that appears in any span attribute / payload / message / tool result **searchable from the UI in <100ms** for any session up to 100k spans.

---

## 3. Non-goals (scope cuts)

| Out of scope | Why |
|---|---|
| Semantic search / embeddings | FTS5 is keyword. Embeddings is a separate (bigger) feature — `F-013-multi-project-isolation` is closer. |
| Cross-machine sync | Local debugger only. |
| Modify plugin behaviour | Read-only on the data side; FTS5 sits on top of spans table. Plugin never writes to the FTS table directly. |
| Backfill historical data on existing installs | Optional but cheap — included if time permits (see §6.4). |
| Replace existing event_name search | Augment it, don't replace — users already muscle-memory'd the old box. |

---

## 4. Design

### 4.1 Storage layer — virtual FTS5 table

Use SQLite's [FTS5 extension](https://www.sqlite.org/fts5.html) (built into `bun:sqlite`, no external dep). One **virtual table** `spans_fts` that mirrors spans text content:

```sql
CREATE VIRTUAL TABLE spans_fts USING fts5(
  span_id UNINDEXED,         -- joins back to spans.id
  run_id UNINDEXED,
  convo_id UNINDEXED,
  span_name,                 -- spans.name
  span_type,                 -- spans.span_type
  model,                     -- spans.model (if LLM)
  content_text,              -- messages + tool args + tool result + attributes (JSON-stringified, all in one column)
  tokenize = 'porter unicode61 remove_diacritics 2'
);
```

**Why FTS5 not FTS4**: FTS5 supports BM25 ranking out of the box, has better tokenizer control, and Bun's `bun:sqlite` ships it (no native module compile).

**Why `content_text` is one column not many**: simpler queries, single index, FTS5 internal ranking handles multi-term relevance. We can split later if we hit precision issues.

### 4.2 Build the FTS row — at write time, not at query time

Workshop daemon already calls `insertSpan()` on every OTLP span arrival (see `src/server.ts`). We add a sibling write to `spans_fts` in the **same transaction**:

```ts
// src/db.ts — extend insertSpan to also write to spans_fts
export function insertSpan(runId: string, span: NewSpan): void {
  const db = getDrizzleDb();
  db.transaction((tx) => {
    tx.insert(schema.spans).values({...span, run_id: runId}).run();
    tx.insert(schema.spans_fts).values({
      span_id: span.id,
      run_id: runId,
      convo_id: <from runs.convo_id>,
      span_name: span.name,
      span_type: span.span_type,
      model: span.model ?? "",
      content_text: buildContentText(span),  // see §4.3
    }).run();
  });
}
```

`buildContentText(span)` extracts:

1. `span.input_payload` (JSON-stringify if object, else as-is)
2. `span.output_payload` (same)
3. `span.attributes` (parsed JSON, only string values, max 1KB total)
4. `messages` extracted from payload (if LLM span) — `system`, `user`, `assistant`, `tool` text content

Cap total at **8KB per span** (configurable). Anything past 8KB is truncated with `[truncated]`.

### 4.3 Query API — single endpoint

```http
GET /api/search?q=<query>&limit=50&offset=0
```

Response shape:

```json
{
  "query": "connection refused",
  "total": 12,
  "results": [
    {
      "run_id": "4cc39c8b...",
      "span_id": "abc123...",
      "span_name": "LLM MiniMax-M3",
      "span_type": "LLM_GENERATION",
      "model": "minimax-coding-plan/MiniMax-M3",
      "snippet": "...HTTP <mark>connection</mark> <mark>refused</mark> when calling...",
      "bm25": -3.45,
      "started_at": 1788519389212
    }
  ]
}
```

Snippet generation uses FTS5's built-in `highlight()` function (BM25 ranked).

### 4.4 UI changes

**Single search box** in the existing top bar of the runs list. Behaviour:

1. User types → debounced 200ms → query `/api/search?q=...`
2. Results render below the runs list as a **new section "Matches (N)"** before the existing run cards
3. Click a match → navigate to `/runs/<run_id>?focus_span=<span_id>` (the run page auto-scrolls/highlights that span)
4. Empty query → hide the section

No new routes, no new tabs. Pure addition.

**Styling:** match existing SearchBox pattern (glass-morphism, mono font, dark theme). Reuse `useQuery` + TanStack Query cache.

### 4.5 What stays the same

- `/api/runs` endpoint — unchanged.
- Run cards — unchanged.
- Existing event_name search inside the runs list — still works (it's a separate code path). The new full-text search is **additive**.

---

## 5. Schema migration

### 5.1 New migration file

`drizzle/0007_fts5_spans.sql`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS spans_fts USING fts5(
  span_id UNINDEXED,
  run_id UNINDEXED,
  convo_id UNINDEXED,
  span_name,
  span_type,
  model,
  content_text,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_spans_fts_run_id ON spans_fts(run_id);

-- Trigger: delete from FTS when span is deleted (so DELETE FROM spans cascades)
-- Implemented in code (in src/db.ts deleteSpan function) — not via SQL trigger
-- to avoid SQLite version compatibility issues.
```

### 5.2 Drizzle schema

`src/db/schema.ts`:

```ts
export const spans_fts = sqliteTable('spans_fts', {
  span_id: text('span_id'),
  run_id: text('run_id'),
  convo_id: text('convo_id'),
  span_name: text('span_name'),
  span_type: text('span_type'),
  model: text('model'),
  content_text: text('content_text'),
});
```

(Drizzle's `sqliteTable` works for FTS5 virtual tables — yes, drizzle supports FTS5 as of late 2024.)

### 5.3 Backfill historical spans (optional but cheap)

On daemon startup, if `spans_fts` is empty AND `spans` table is non-empty, run:

```sql
INSERT INTO spans_fts(span_id, run_id, convo_id, span_name, span_type, model, content_text)
SELECT s.id, s.run_id, r.convo_id, s.name, s.span_type, COALESCE(s.model, ''), ...
FROM spans s JOIN runs r ON s.run_id = r.id;
```

This is a one-time ~1-2s operation on Kolya's ~520-span DB. Log the row count, never block daemon startup >2s (chunked INSERT if larger DB).

---

## 6. Implementation plan — atomic commits

### Commit 1: F-008-P1 — Backend storage layer
- `src/db/schema.ts` — add `spans_fts` table definition
- `src/db.ts` — extend `insertSpan()` to also write to `spans_fts`
- `drizzle/0007_fts5_spans.sql` — migration
- `src/db.ts` — `getSpanContentText(span)` helper (extracted for testability)
- `tests/fts-content-text.test.ts` — 10 unit tests on content extraction (cap, JSON parse, message extraction, attribute flattening)

**Verification:**
- `bun x tsc --noEmit` clean
- `bun run lint` 0 errors
- Manual: run OpenCode with plugin → new spans have FTS rows (verify with `sqlite3 ~/.raindrop/raindrop_workshop.db "SELECT COUNT(*) FROM spans_fts"`)

### Commit 2: F-008-P2 — Search endpoint
- `src/server.ts` — `GET /api/search?q=&limit=&offset=` route
- `src/db.ts` — `searchSpans(query, limit, offset)` with BM25 ranking + highlight snippets
- `tests/search-api.test.ts` — 8 integration tests (empty query, exact match, multi-term, no results, paging, special chars)

**Verification:**
- `curl 'http://localhost:5899/api/search?q=think'` returns spans containing "think"
- Response time <100ms for 10k spans

### Commit 3: F-008-P3 — Backfill + UI
- `src/db.ts` — `backfillFts()` runs on daemon startup if table empty
- `app/src/api/search.ts` — `searchSpans()` API client + types
- `app/src/hooks/use-search.ts` — debounced TanStack Query hook
- `app/src/components/SearchBox.tsx` — extend with full-text mode (or `SearchResults.tsx` separate component)
- `app/src/components/RunDetail.tsx` — accept `?focus_span=<id>` query param, scroll+highlight that span on mount

**Verification:**
- Fresh daemon start → backfill runs once, ~1-2s for Kolya's DB
- Type "connection" in UI → see "Matches (3)" with snippets
- Click a match → navigates to RunDetail with span highlighted

### Commit 4 (optional): F-008-P4 — Polish
- Highlighted spans stay highlighted 2s after navigation (so user notices)
- SearchBox keyboard shortcut (Cmd/Ctrl+K)
- "Show in run" link copies run id to clipboard

Skip P4 if time is short.

---

## 7. Performance targets

| Metric | Target | Kolya's DB |
|---|---|---|
| Index size | <50% of spans table size | ~520 spans → ~250KB |
| Insert overhead | <2ms per span | OTLP rate typically <100 spans/run |
| Query latency (1k spans) | <20ms p95 | TBD |
| Query latency (10k spans) | <100ms p95 | TBD |
| Query latency (100k spans) | <500ms p95 | TBD |

If we miss p95 at 100k spans: revisit tokenizer (drop `porter`), or shard by `run_id`.

---

## 8. Testing strategy

### Unit tests (commit 1)
- `tests/fts-content-text.test.ts` — 10 tests on `getSpanContentText`:
  - Plain string payload
  - JSON object payload (nested, arrays, nulls)
  - Payload with `[REDACTED]` markers (don't index)
  - LLM span with messages (extract system/user/assistant text only)
  - Tool span with args + result
  - Attributes: filter non-string values, flatten nested
  - Cap at 8KB (truncate mid-string, append `[truncated]`)
  - Empty payload returns empty string
  - Malformed JSON attributes → skip, don't crash
  - Unicode (emoji, Cyrillic) round-trip

### Integration tests (commit 2)
- `tests/search-api.test.ts` — 8 tests on `/api/search`:
  - `?q=` empty → 400 Bad Request
  - `?q=` with spaces → multi-term AND
  - `?q=think` matches `think_think` span name
  - `?q=MiniMax-M3` matches spans with model attribute
  - `?q=connection refused` quotes handled
  - `?q=nonexistent_xyz_123` → empty results, total=0
  - `?limit=2&offset=4` paging works
  - `?q=` with `bm25` ordering preserved (most relevant first)

### E2E test (commit 3)
- `scripts/smoke-test-fts.sh`:
  1. Reset DB
  2. Run plugin against OpenCode with `fff_find_files`
  3. POST a span with known content
  4. Query `/api/search?q=<known_word>` → expect 1 result with that span
  5. Click result in UI → RunDetail opens with span highlighted

### Manual smoke
- Type "OpenCode" in UI → see spans containing the model name
- Type "task" → see all `task` tool spans
- Type a Cyrillic word from a known session → see it

---

## 9. Rollout plan

1. Implement P1-P3 (skip P4).
2. Bun test + lint + manual smoke.
3. **Kolya's explicit "restart" → he restarts `raindrop workshop serve` daemon.**
4. Kolya eyeballs the new search box on his live DB.
5. Iterate on UX issues (snippet length, highlighting) before declaring done.
6. **Kolya's explicit "push" → push to origin/main.**
7. Done.

---

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| FTS5 not built into `bun:sqlite` on Kolya's machine | Verify before commit 1: `bun -e 'console.log(typeof new Database(":memory:").prepare("CREATE VIRTUAL TABLE t USING fts5(x)").run)'` |
| Drizzle doesn't generate the right SQL for FTS5 virtual table | Write the migration as raw SQL (`0007_fts5_spans.sql`), use `drizzle.execute(sql\`...\`)` to apply |
| Index grows large on long-running workshops | Document cleanup: `DELETE FROM spans_fts WHERE run_id IN (SELECT id FROM runs WHERE started_at < ?)` |
| Snippet highlighting too noisy (highlight every match in 1MB payload) | Cap snippet length at 200 chars; truncate around match offset |
| Cyrillic / emoji search miss | Use `unicode61` tokenizer (handles non-ASCII) |

---

## 11. Files touched (final list)

```
drizzle/0007_fts5_spans.sql                        NEW
src/db.ts                                         MODIFIED (insertSpan + new helpers)
src/db/schema.ts                                  MODIFIED (spans_fts table)
src/server.ts                                     MODIFIED (GET /api/search)
src/fts.ts                                        NEW (buildSpanContentText helper)
tests/fts-content-text.test.ts                    NEW
tests/search-api.test.ts                          NEW
scripts/smoke-test-fts.sh                         NEW
app/src/api/search.ts                             NEW
app/src/hooks/use-search.ts                       NEW
app/src/components/SearchBox.tsx                  MODIFIED (or SearchResults.tsx NEW)
app/src/components/RunDetail.tsx                  MODIFIED (?focus_span param)
ai-docs/PLAN.md                                   MODIFIED (F-008 entry + todos)
```

Total: ~12 files, 8 new + 4 modified. Estimated diff size: +800 lines, -50 lines.

---

## 12. Done criteria (definition of done)

- [ ] All 4 commits merged locally on `main`
- [ ] `bun x tsc --noEmit` 0 errors
- [ ] `bun run lint` 0 errors (no new warnings)
- [ ] `bun test` all tests pass (existing + new 18 tests)
- [ ] Manual smoke: live search returns matches in <100ms on Kolya's DB
- [ ] Daemon restart successful (Kolya restart)
- [ ] PLAN.md updated with `Closed YYYY-MM-DD`
- [ ] HANDOFF snapshot updated
- [ ] **Kolya's explicit "push" given** before pushing

---

*Prepared by Miko for Kolya, 2026-09-04. Ready for the next session.*

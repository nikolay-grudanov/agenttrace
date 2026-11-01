import { spawnSync } from "node:child_process";
import { test, expect, REPO_ROOT_PATH } from "./fixtures";
import { readWorkshopRun, readWorkshopSpans } from "./helpers";

// Workshop-only specs: exercise the workshop daemon + UI directly without
// involving any example app or external LLM. Seeded fixtures from
// `scripts/seed-traces.ts` give us deterministic data, so these stay
// fast (no LLM round-trip) and run on every PR via the cheap CI lane.
//
// Fixture 1 (`fixtureSuccessfulEdit`) has a pinned trace id of
// `00000000000000000000000000000001`, event_name=`code-agent`, and 6
// spans (1 INTERNAL + 3 LLM_GENERATION + 2 TOOL_CALL). The seed script
// is the source of truth — if it changes, update these numbers in lock
// step with that change.
const FIXTURE_RUN_ID = "00000000000000000000000000000001";
const FIXTURE_EVENT_NAME = "code-agent";
const FIXTURE_SPAN_COUNT = 6;

async function seedFixtures(workshopUrl: string) {
  const seed = spawnSync("bun", ["scripts/seed-traces.ts"], {
    cwd: REPO_ROOT_PATH,
    env: { ...process.env, AGENTTRACE_WORKSHOP_URL: workshopUrl },
    stdio: "inherit",
  });
  expect(seed.status, "seed-traces.ts failed").toBe(0);
}

async function clearWorkshop(workshopUrl: string) {
  const res = await fetch(`${workshopUrl}/api/clear`, { method: "POST" });
  expect(res.ok, `POST /api/clear -> ${res.status}`).toBe(true);
}

// Each test gets a clean slate. Tests that need fixtures call seedFixtures
// themselves so it's obvious in the spec what data each one depends on.
test.beforeEach(async ({ workshop }) => {
  await clearWorkshop(workshop.url);
});

test("workshop UI: clear button empties runs list and DB", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  const before = (await (await fetch(`${workshop.url}/api/runs?limit=5000`)).json()) as unknown[];
  expect(before.length).toBeGreaterThanOrEqual(3);

  await page.goto(workshop.url);
  page.on("dialog", (d) => d.accept());

  const clearBtn = page.getByRole("button", { name: /^clear$/i });
  await expect(clearBtn).toBeVisible({ timeout: 10_000 });
  await clearBtn.click();

  await expect
    .poll(async () => ((await (await fetch(`${workshop.url}/api/runs?limit=5000`)).json()) as unknown[]).length, {
      timeout: 10_000,
    })
    .toBe(0);
});

test("workshop UI: run list shows seeded runs, search filters them", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  await page.goto(workshop.url);

  // All 3 seeded runs land in the sidebar as <div data-run-id="..."> wrappers.
  // The seed script always writes salt=0 fixtures, so trace ids 1/2/3 are stable.
  const allRows = page.locator("[data-run-id]");
  await expect.poll(async () => allRows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator(`[data-run-id="${FIXTURE_RUN_ID}"]`)).toBeVisible();

  // Search filters by event_name / id / prompt. `code-agent` matches every
  // fixture; a deliberately bogus query must collapse the list to zero.
  // This guards the search wiring, not the fuzzy-match algorithm.
  const search = page.getByPlaceholder(/search runs/i);
  await search.fill("definitely-not-a-real-event-name-xyz");
  await expect.poll(async () => allRows.count(), { timeout: 5_000 }).toBe(0);

  await search.fill("");
  await expect.poll(async () => allRows.count(), { timeout: 5_000 }).toBeGreaterThanOrEqual(3);
});

test("workshop UI: span tree + side panel render seeded run", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  // Cross-check the DB before driving the UI — if seeding silently produced
  // the wrong shape, fail with a clear DB-side message rather than a
  // confusing UI assertion failure later.
  const run = await readWorkshopRun(workshop.url, FIXTURE_RUN_ID);
  expect(run, `expected seeded run ${FIXTURE_RUN_ID} in DB`).not.toBeNull();
  expect(run!.event_name).toBe(FIXTURE_EVENT_NAME);
  const dbSpans = await readWorkshopSpans(workshop.url, FIXTURE_RUN_ID);
  expect(dbSpans.length).toBe(FIXTURE_SPAN_COUNT);

  await page.goto(`${workshop.url}/runs/${FIXTURE_RUN_ID}`);

  // Header shows the run's event_name.
  await expect(page.getByText(FIXTURE_EVENT_NAME).first()).toBeVisible({ timeout: 10_000 });

  // Span Tree tab: rows are stamped with data-span-row=<id>. Each DB
  // span must surface as a tree row (the renderer may also add synthetic
  // sub-agent boundary rows, so use >= rather than ==). A tree count
  // less than the DB count means the renderer dropped a span or the API
  // hid one.
  await page.getByRole("button", { name: /^span tree$/i }).click();
  const rows = page.locator("[data-span-row]");
  await expect.poll(async () => rows.count(), { timeout: 5_000 }).toBeGreaterThanOrEqual(FIXTURE_SPAN_COUNT);
  // Every DB span id must be present as a tree row — ensures the renderer
  // doesn't pad with junk while skipping real spans.
  for (const s of dbSpans) {
    await expect(page.locator(`[data-span-row="${s.id}"]`)).toBeVisible({ timeout: 5_000 });
  }

  // Side panel: clicking a row opens SpanDetail with Input/Output sections.
  // Select a DB-backed span that has both payloads and wait for the routed
  // `/span/:id` selection before asserting the detail pane.
  const detailSpan = dbSpans.find((span) => span.input_payload && span.output_payload);
  expect(detailSpan, "expected at least one seeded span with input and output payloads").toBeTruthy();
  await page.locator(`[data-span-row="${detailSpan!.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/span/${detailSpan!.id}(?:[/?#]|$)`));
  await expect(page.getByText(/^Input$/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^Output$/).first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Fix the typo in README\.md/).first()).toBeVisible({ timeout: 5_000 });
});

test("workshop UI: new run from SDK appears live in sidebar without reload", async ({ page, workshop }) => {
  // Workshop's value proposition is "watch traces stream in live". The
  // sidebar refetches on every ws message (see RunsPage.tsx ws.onmessage),
  // so a regression that silently drops the broadcast — or one where the
  // sidebar uses a stale snapshot — would only surface in production.
  // Open the UI on an empty workshop, then push one fixture through the
  // OTLP intake and assert the row materializes within a few seconds
  // without any manual reload.
  await page.goto(workshop.url);
  await expect(page.getByText(/no runs/i).first()).toBeVisible({ timeout: 10_000 });

  await seedFixtures(workshop.url);

  const row = page.locator(`[data-run-id="${FIXTURE_RUN_ID}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
});

test("workshop UI: switching between runs preserves each run's span tree", async ({ page, workshop }) => {
  // PR #100-class regression: UI state silently desynced from data on a
  // transition (the chat pane cleared streamed blocks before the
  // transcript replaced them). The analogous risk in this app is the
  // run-detail pane carrying stale span data when the user clicks back
  // to a previously-viewed run — e.g. an over-aggressive memoization key
  // or a missing dependency in a useEffect. Switching A → B → A and
  // asserting both renders cover that class without coupling to any
  // specific implementation detail.
  await seedFixtures(workshop.url);

  const RUN_A = "00000000000000000000000000000001"; // 6 spans, agent.turn root
  const RUN_B = "00000000000000000000000000000003"; // 11 spans, nested sub-agents (subagent.review > subagent.lint)

  const spansA = await readWorkshopSpans(workshop.url, RUN_A);
  const spansB = await readWorkshopSpans(workshop.url, RUN_B);
  expect(spansA.length).toBeLessThan(spansB.length); // sanity: distinct shapes

  // Helper: switching runs in the sidebar resets the active tab to the
  // default (Overview), so re-click Span Tree after each navigation.
  const openSpanTree = async () => {
    await page.getByRole("button", { name: /^span tree$/i }).click();
  };

  await page.goto(`${workshop.url}/runs/${RUN_A}`);
  await openSpanTree();
  const rows = page.locator("[data-span-row]");
  // Same `>=` rationale as line 104: the renderer may add synthetic
  // sub-agent boundary rows, so all run-counts use `>=` for consistency.
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(spansA.length);
  await expect(page.locator(`[data-span-row="${spansA[0].id}"]`)).toBeVisible();

  // Click into run B in the sidebar — exercises the same code path users
  // hit when bouncing between traces during debugging.
  await page.locator(`[data-run-id="${RUN_B}"]`).click();
  await openSpanTree();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(spansB.length);
  await expect(page.locator(`[data-span-row="${spansB[0].id}"]`)).toBeVisible();
  // Run A's root span must NOT linger in the tree after switching — that
  // would mean we're rendering stale data alongside the new run.
  await expect(page.locator(`[data-span-row="${spansA[0].id}"]`)).toHaveCount(0);

  // Back to A: shape must be identical to the first render, not a stale
  // mix from B. The stale-state check is: A's root re-appears AND B's
  // root is gone — `>=` on count is enough since the per-id assertions
  // pin down identity.
  await page.locator(`[data-run-id="${RUN_A}"]`).click();
  await openSpanTree();
  await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(spansA.length);
  await expect(page.locator(`[data-span-row="${spansA[0].id}"]`)).toBeVisible();
  await expect(page.locator(`[data-span-row="${spansB[0].id}"]`)).toHaveCount(0);
});

test("workshop UI: deleting a run via API removes it from the sidebar", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  await page.goto(workshop.url);
  const targetRow = page.locator(`[data-run-id="${FIXTURE_RUN_ID}"]`);
  await expect(targetRow).toBeVisible({ timeout: 10_000 });

  // DELETE /api/runs/:id is the workhorse for the per-row delete control;
  // the websocket broadcast triggers a sidebar refetch. Without that wiring
  // the UI keeps showing stale runs even after the row is gone from the DB.
  const del = await fetch(`${workshop.url}/api/runs/${FIXTURE_RUN_ID}`, { method: "DELETE" });
  expect(del.ok, `DELETE /api/runs/${FIXTURE_RUN_ID} -> ${del.status}`).toBe(true);

  await expect(targetRow).toHaveCount(0, { timeout: 5_000 });
  // The other two seeded runs must still be present — delete must be scoped,
  // not a stealth `clearAll`.
  await expect.poll(async () => page.locator("[data-run-id]").count(), { timeout: 5_000 }).toBe(2);
});

test("workshop UI: sub-agent root span shows gold badge, friendly label, and in-tree SubAgentBlock", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  // Fixture 3 has a sub-agent: TOOL_CALL "subagent.review" > LLM > TOOL_CALL (Pattern 1).
  const RUN_B = "00000000000000000000000000000003";
  const dbSpans = await readWorkshopSpans(workshop.url, RUN_B);
  const subAgentRoot = dbSpans.find((s) => s.name === "subagent.review");
  expect(subAgentRoot, "expected subagent.review span in fixture 3").toBeTruthy();

  await page.goto(`${workshop.url}/runs/${RUN_B}`);
  await page.getByRole("button", { name: /^span tree$/i }).click();

  // (1) Gold #d4a857 badge on the sub-agent root row, distinct from TOOL_CALL #b08c5a.
  const rootRow = page.locator(`[data-span-row="${subAgentRoot!.id}"]`);
  await expect(rootRow).toBeVisible({ timeout: 10_000 });
  const badge = rootRow.locator("span.text-\\[10px\\]").first();
  const badgeColor = await badge.evaluate((el) => getComputedStyle(el).color);
  expect(badgeColor).toBe("rgb(212, 168, 87)");

  // (2) AGENT badge label (not generic TOOL). "task"-named roots would show "Sub-agent: ...";
  // this fixture uses "subagent.review" (Pattern 1), so the raw name is preserved.
  const badgeLabel = await badge.textContent();
  expect(badgeLabel?.trim()).toBe("AGENT");

  // (3) In-tree SubAgentBlock visible when sub-agents exist, absent when they don't.
  const subAgentBlock = page.locator('[data-testid="span-tree-subagent-block"]');
  await expect(subAgentBlock).toBeVisible({ timeout: 5_000 });

  await page.locator(`[data-run-id="${FIXTURE_RUN_ID}"]`).click();
  await page.getByRole("button", { name: /^span tree$/i }).click();
  await expect(subAgentBlock).toHaveCount(0, { timeout: 5_000 });
});

test("workshop UI: sub-agent drill-down — focused view, breadcrumb chain, nested dive", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  const RUN_B = "00000000000000000000000000000003";
  await page.goto(`${workshop.url}/runs/${RUN_B}`);
  await page.getByRole("button", { name: /^span tree$/i }).click();

  const section = page.locator('[data-testid="span-tree-subagent-block"]');
  await expect(section).toBeVisible({ timeout: 10_000 });
  // The section maps ALL detected agents (SpanTree L483), not just top-level ones —
  // review and nested lint both render as SubAgentBlocks inside this container.
  await section.getByRole("button", { name: /subagent\.review/i }).click();
  await page.getByRole("button", { name: /open sub-agent/i }).click();

  await expect(page.getByRole("heading", { name: /subagent\.review/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "code-agent", exact: true })).toBeVisible();

  // Session Tree tab appears in the focused view only when childAgents.length > 0 (RunDetail).
  await page.getByRole("button", { name: /^session tree$/i }).click();
  await expect(page.getByText("subagent.lint").first()).toBeVisible();
  await page.getByRole("button", { name: /^open$/i }).click();

  await expect(page.getByRole("button", { name: "code-agent", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "subagent.review", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /subagent\.lint/i })).toBeVisible();

  await page.getByRole("button", { name: "code-agent", exact: true }).click();
  await expect(page.getByRole("button", { name: /^span tree$/i })).toBeVisible();
});

test("workshop UI: flame timeline shows gold sub-agent bands and click-to-dive", async ({ page, workshop }) => {
  await seedFixtures(workshop.url);

  const RUN_B = "00000000000000000000000000000003";
  await page.goto(`${workshop.url}/runs/${RUN_B}`);

  // Two sub-agents (outer + nested) → two time bands and two gold root bars on the run overview.
  await expect(page.locator('[data-testid="flame-subagent-band"]')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('[data-testid="flame-subagent-bar"]')).toHaveCount(2);

  // Clicking a root bar dives into that sub-agent instead of focusing the span.
  // Row order in the DOM isn't contractually alphabetical, so we don't assert which
  // agent — only that the dive happens (focused heading + breadcrumb back control appear).
  await page.locator('[data-testid="flame-subagent-bar"]').first().click();
  await expect(page.getByRole("heading", { name: /subagent\.(review|lint)/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "code-agent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "code-agent", exact: true }).click();
  await expect(page.getByRole("button", { name: /^overview$/i })).toBeVisible();
});

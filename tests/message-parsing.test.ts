/**
 * Tests for app/src/utils/messageParsing.ts — accepts/rejects content blocks.
 *
 * F-029 acceptance: an image/file content block in `messages[].content[]`
 * must NOT contribute its (potentially base64) `text`/`content` field to the
 * rendered message text. Otherwise MessageList may render base64 bytes as
 * markdown, and a future image-renderer path could interpret them as
 * `<img src="data:...">` HTML.
 *
 * Scope: synthetic JSON only. We don't ship an image-bearing fixture trace
 * because OpenCode currently doesn't emit image content blocks for our fork's
 * usage patterns; the test asserts the parser-level invariant instead.
 */

import { describe, expect, test } from "bun:test";
import { parseMessages } from "../app/src/utils/messageParsing";

// Minimal base64 payload that stands in for a tiny PNG. We never assert that
// the parser looks inside the base64; we only assert that the block is dropped
// from the message text and that a sibling text block in the same array still
// surfaces normally.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function assertNoBase64In(msgs: ReturnType<typeof parseMessages>) {
  if (msgs === null) return;
  for (const m of msgs) {
    expect(m.content).not.toContain(TINY_PNG_B64);
    expect(m.content).not.toContain("iVBORw0KGgo");
  }
}

describe("F-029 image/file content blocks", () => {
  test("image block alone does not leak base64 as text", () => {
    const raw = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: TINY_PNG_B64 },
            },
          ],
        },
      ],
    });
    const msgs = parseMessages(raw);
    // The message itself may be null (image-only turn with no text) — that's
    // fine. The hard invariant: NO base64 leaks into any returned message.
    assertNoBase64In(msgs);
  });

  test("image block is skipped when sibling text block is present", () => {
    const raw = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this picture?" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: TINY_PNG_B64 },
            },
          ],
        },
      ],
    });
    const msgs = parseMessages(raw);
    expect(msgs).not.toBeNull();
    expect(msgs!.length).toBe(1);
    expect(msgs![0].role).toBe("user");
    expect(msgs![0].content).toBe("What's in this picture?");
    expect(msgs![0].content).not.toContain(TINY_PNG_B64);
  });

  test("file block with image mediaType is dropped", () => {
    const raw = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "See attached:" },
            {
              type: "file",
              mediaType: "image/png",
              data: TINY_PNG_B64,
            },
          ],
        },
      ],
    });
    const msgs = parseMessages(raw);
    expect(msgs).not.toBeNull();
    expect(msgs!.length).toBe(1);
    expect(msgs![0].content).toBe("See attached:");
    expect(msgs![0].content).not.toContain(TINY_PNG_B64);
  });

  test("image block with non-standard `text` field is still dropped (regression)", () => {
    // Worst-case shape: someone (or a buggy SDK) stuffs base64 into a `text`
    // field on an image block. Without the F-029 guard, the trailing
    // `if (typeof c.text === "string") return c.text` branch would surface
    // the base64 as canonical message text and render it in MessageList.
    const raw = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              text: TINY_PNG_B64, // pathological — should still be ignored
              source: { type: "base64", media_type: "image/png" },
            },
          ],
        },
      ],
    });
    const msgs = parseMessages(raw);
    assertNoBase64In(msgs);
  });
});
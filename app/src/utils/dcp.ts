/**
 * F-021: shared client-side parser for opencode-dcp `compress` tool payloads.
 *
 * Wire contract (range mode, the default):
 *   input_payload = { "topic": string,
 *                     "content": [{ "startId": "m0001", "endId": "m0003",
 *                                   "summary": "…" }, …] }
 *   output_payload = "Compressed N messages into [Compressed conversation section]."
 *
 * Message mode (experimental) carries only block refs in `content`; full
 * summaries live in DCP's own storage and are not on the span.
 *
 * Detection is by payload shape, NOT by an "opencode-dcp" marker in
 * `attributes`: the plugin stamps only `ai.toolCall.name` there, so a marker
 * gate silently fails on real data (the F-020 bug). The topic+content-with-
 * startId shape is the actual contract.
 */
import { tryJson } from "./helpers";
import type { Span } from "./types";

export interface DcpBlock {
  startId?: string;
  endId?: string;
  summary?: string;
}

export interface DcpCompression {
  topic: string | null;
  blocks: DcpBlock[];
  mode: "range" | "message";
  messagesCompressed: number | null;
}

export function parseDcpCompression(span: Pick<Span, "name" | "input_payload" | "output_payload">): DcpCompression | null {
  if (span.name !== "compress") return null;
  const inp = tryJson(span.input_payload);
  if (!inp || typeof inp !== "object" || Array.isArray(inp)) return null;
  const obj = inp as Record<string, unknown>;
  const content = Array.isArray(obj.content) ? obj.content : [];
  if (content.length === 0) return null;
  const topic = typeof obj.topic === "string" ? obj.topic : null;

  const blocks: DcpBlock[] = [];
  let mode: "range" | "message" = "message";
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const hasIds = typeof b.startId === "string" || typeof b.endId === "string";
    if (!hasIds) continue;
    if (typeof b.summary === "string" && b.summary.length > 0) mode = "range";
    blocks.push({
      startId: typeof b.startId === "string" ? b.startId : undefined,
      endId: typeof b.endId === "string" ? b.endId : undefined,
      summary: typeof b.summary === "string" ? b.summary : undefined,
    });
  }
  if (blocks.length === 0) return null;

  let messagesCompressed: number | null = null;
  if (typeof span.output_payload === "string") {
    const m = span.output_payload.match(/Compressed\s+(\d+)\s+messages/i);
    if (m) messagesCompressed = Number(m[1]);
  }

  return { topic, blocks, mode, messagesCompressed };
}

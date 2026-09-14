import type { SpanType } from "./types";

/**
 * Single source of truth for span-type colours across the Span Tree and
 * Flame Timeline tabs. Both components import from here so a TOOL_CALL span
 * renders the same colour in each view.
 *
 * Palette rationale:
 *  - TRACE / LLM_GENERATION / TOOL_CALL / INTERNAL preserve the colours that
 *    previously lived inline in `SpanTree.tsx`'s `TYPE_LABEL` map.
 *  - SUB_AGENT_ROOT is the F-003 gold (`#d4a857`) — preserved verbatim.
 *  - AGENT_ROOT / CHAIN / RETRIEVER / EMBEDDING are new and chosen to be
 *    visually distinct from the existing families.
 */
export const SPAN_TYPE_COLORS: Record<SpanType, string> = {
  TRACE: "#A57CF5",
  LLM_GENERATION: "#5a8ab0",
  TOOL_CALL: "#b08c5a",
  AGENT_ROOT: "#6DB3F2",
  INTERNAL: "#5a6a72",
  CHAIN: "#94A3B8",
  RETRIEVER: "#4FCAE3",
  EMBEDDING: "#8BC34A",
  SUB_AGENT_ROOT: "#d4a857",
  // F-020: teal — distinct from agent-root gold so "context management"
  // doesn't visually compete with "delegated sub-agent".
  COMPRESSION: "#5fbfb0",
};

/**
 * Short badge labels rendered alongside the colour chip. Kept in the same
 * module so colour + label never drift out of sync.
 */
export const SPAN_TYPE_LABELS: Record<SpanType, string> = {
  TRACE: "TRACE",
  LLM_GENERATION: "LLM",
  TOOL_CALL: "TOOL",
  AGENT_ROOT: "ROOT",
  INTERNAL: "SPAN",
  CHAIN: "CHAIN",
  RETRIEVER: "RETR",
  EMBEDDING: "EMBED",
  SUB_AGENT_ROOT: "AGENT",
  COMPRESSION: "COMP",
};

export function spanColor(type: SpanType): string {
  return SPAN_TYPE_COLORS[type];
}

/**
 * F-020/F-021: tool spans named "compress" whose payload carries the
 * opencode-dcp contract (topic + content blocks with startId/endId) are
 * projected to the dedicated COMPRESSION type. The transform requires the
 * span — payload shape is the real contract; `attributes` carry only
 * `ai.toolCall.name`, so a marker gate there silently fails on real data.
 */
export function spanTypeFromRaw(
  spanType: string | null | undefined,
  span?: { name?: string | null; input_payload?: string | null },
): SpanType {
  if (
    span &&
    typeof span.name === "string" &&
    span.name === "compress" &&
    typeof span.input_payload === "string" &&
    span.input_payload.includes("\"content\":") &&
    /"(startId|endId)"/.test(span.input_payload)
  ) {
    return "COMPRESSION";
  }
  switch (spanType) {
    case "TRACE": return "TRACE";
    case "TOOL_CALL": return "TOOL_CALL";
    case "AGENT_ROOT": return "AGENT_ROOT";
    case "CHAIN": return "CHAIN";
    case "RETRIEVER": return "RETRIEVER";
    case "EMBEDDING": return "EMBEDDING";
    case "SUB_AGENT_ROOT": return "SUB_AGENT_ROOT";
    default:
      if (typeof spanType === "string" && spanType.includes("LLM")) return "LLM_GENERATION";
      return "INTERNAL";
  }
}

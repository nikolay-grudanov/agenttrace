/**
 * F-021: shared teal banner rendering what an opencode-dcp `compress` call
 * kept. Used by ToolCallPill (chat/convo stream) and SpanDetail (right
 * rail) so both surfaces show identical compression information.
 *
 * Per-block summaries are truncated to PREVIEW_CHARS with a "See full
 * summary" toggle that expands the whole text (the F-020 banner printed
 * each block in full, which flooded the pill for long summaries).
 */
import { useState } from "react";
import { C } from "../utils/colors";
import { fmt } from "../utils/helpers";
import { parseDcpCompression } from "../utils/dcp";
import type { Span } from "../utils/types";

export const DCP_TONE = "#5fbfb0";
const PREVIEW_CHARS = 220;

function SummaryText({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  const shown = full || !long ? text : text.slice(0, PREVIEW_CHARS) + "…";
  return (
    <div>
      <pre
        className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words"
        style={{ color: C.fg2 }}
      >
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          className="text-[10px] font-medium transition-colors"
          style={{ color: DCP_TONE }}
          onClick={() => setFull(v => !v)}
        >
          {full ? "↑ collapse summary" : `See full summary (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
}

export function DcpCompressionBlock({ span, showDuration = true }: { span: Span; showDuration?: boolean }) {
  const dcp = parseDcpCompression(span);
  if (!dcp) return null;
  const replaced = dcp.blocks.filter(b => b.summary).length;
  return (
    <div
      className="px-3 py-2 space-y-1.5"
      style={{ background: `${DCP_TONE}0a`, borderBottom: `1px solid ${DCP_TONE}33` }}
    >
      <div className="text-[9px] uppercase tracking-wide font-sans font-medium flex items-center gap-2" style={{ color: DCP_TONE }}>
        <span>DCP compression</span>
        {dcp.topic && <span style={{ color: C.fg2 }}>· {dcp.topic}</span>}
        <span style={{ color: C.fg0 }}>
          · {replaced} block{replaced === 1 ? "" : "s"} replaced
          {dcp.messagesCompressed != null ? ` · ${dcp.messagesCompressed} message${dcp.messagesCompressed === 1 ? "" : "s"}` : ""}
        </span>
        {showDuration && <span className="ml-auto font-mono" style={{ color: C.fg0 }}>{fmt(span.duration_ms)}</span>}
      </div>
      {dcp.blocks.map((b, i) => (
        <div key={`dcpb${i}`} className="space-y-0.5">
          {(b.startId || b.endId) && (
            <div className="text-[9px] font-mono" style={{ color: C.fg0 }}>
              {b.startId ?? "?"} → {b.endId ?? "?"}
            </div>
          )}
          {b.summary ? (
            <SummaryText text={b.summary} />
          ) : (
            <div className="text-[10px] italic" style={{ color: C.fg0 }}>
              block ref only (message mode) — summary lives in DCP storage
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

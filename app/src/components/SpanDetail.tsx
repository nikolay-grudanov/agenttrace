import { useEffect, useState } from "react";
import { C } from "../utils/colors";
import { fmt, tryJson, detectProvider } from "../utils/helpers";
import { spanTypeFromRaw } from "../utils/span-colors";
import type { Span } from "../utils/types";
import { Chevron } from "./Icons";
import { JsonView } from "./JsonView";
import { MessageList, messagesFromSpan } from "./MessageList";

const TYPE_LABEL = {
  TRACE: { color: C.purple, label: "TRACE" },
  TOOL_CALL: { color: "#b08c5a", label: "TOOL" },
  SUB_AGENT_ROOT: { color: "#d4a857", label: "AGENT" },
  LLM_GENERATION: { color: "#5a8ab0", label: "LLM" },
  INTERNAL: { color: C.fg0, label: "SPAN" },
  COMPRESSION: { color: "#5fbfb0", label: "COMP" },
} as const;

function typeInfo(span: Span) {
  const t = spanTypeFromRaw(span.span_type, span);
  return TYPE_LABEL[t];
}

function CollapsibleSection({ title, preview, data, maxExpand = 3 }: { title: string; preview: string; data: unknown; maxExpand?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="flex items-center gap-2 w-full text-left" onClick={() => setOpen(!open)}>
        <Chevron open={open} size={8} />
        <span className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.fg1 }}>{title}</span>
        {!open && <span className="text-[10px] font-mono truncate flex-1" style={{ color: C.fg0 }}>{preview}</span>}
      </button>
      {open && (
        <div className="mt-1 p-2 rounded" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}` }}>
          <JsonView data={data} maxExpand={maxExpand} />
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-[10px] font-mono px-1.5 py-0.5 rounded transition"
      style={{ color: copied ? C.green : C.fg0, background: "rgba(255,255,255,0.03)" }}
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

type SpanDetailTab = "messages" | "metadata";

export function SpanDetail({ span, allSpans }: { span: Span; allSpans?: Span[] }) {
  const info = typeInfo(span);
  const isErr = span.status === "ERROR";
  const isLLM = info === TYPE_LABEL.LLM_GENERATION;
  const messages = isLLM ? messagesFromSpan(span) : null;
  const hasMessages = !!messages && messages.length > 0;
  const [tab, setTab] = useState<SpanDetailTab>(isLLM ? "messages" : "metadata");

  // F-012: resolve parent and children from the full spans list when provided.
  const parentSpan = allSpans && span.parent_span_id
    ? allSpans.find(s => s.id === span.parent_span_id)
    : null;
  const children = allSpans
    ? allSpans.filter(s => s.parent_span_id === span.id)
    : [];

  useEffect(() => {
    setTab(isLLM ? "messages" : "metadata");
  }, [span.id, isLLM]);

  const showMessagesTab = isLLM && hasMessages;
  const activeTab: SpanDetailTab = tab === "messages" && !showMessagesTab ? "metadata" : tab;

  const tabStyle = (k: SpanDetailTab) => ({
    padding: "6px 10px", fontSize: "11px", fontWeight: 500, cursor: "pointer" as const,
    background: "none", border: "none",
    color: activeTab === k ? C.fg5 : C.fg0,
    borderBottom: activeTab === k ? `2px solid ${C.fg4}` : "2px solid transparent",
  });

  return (
    <div className="p-4 space-y-3 h-full overflow-auto sb">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: info.color, background: `${info.color}15`, marginLeft: -6 }}>
            {info.label}
          </span>
          {isErr && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: C.red, background: "rgba(204,102,102,0.1)" }}>ERROR</span>}
          {(() => { const p = detectProvider(span.model, span.provider); return p ? <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded" style={{ color: C.fg1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>{p.label}</span> : null; })()}
        </div>
        <div className="text-sm font-mono font-medium" style={{ color: C.fg4 }}>{span.name}</div>
      </div>

      {isErr && span.output_payload && (
        <div className="rounded-lg p-2.5" style={{ background: "rgba(204,102,102,0.06)", border: "1px solid rgba(204,102,102,0.12)" }}>
          <div className="text-[9px] uppercase tracking-wide mb-1 font-medium" style={{ color: C.red }}>Error</div>
          <pre className="text-[11px] font-mono leading-relaxed" style={{ color: C.red }}>{tryJson(span.output_payload)}</pre>
        </div>
      )}

      {/* F-020: dedicated block for the right-rail SpanDetail when the
          clicked span is an opencode-dcp compress call. Mirrors the
          ToolCallPill banner (locally inlined for this Feature; F-021
          consolidates both into a shared component). */}
      {info === TYPE_LABEL.COMPRESSION && span.input_payload && (() => {
        let parsed: unknown;
        try { parsed = JSON.parse(span.input_payload); } catch { parsed = null; }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const obj = parsed as Record<string, unknown>;
        const content = Array.isArray(obj.content) ? obj.content : [];
        if (content.length === 0) return null;
        const blocks: Array<Record<string, unknown>> = [];
        for (const raw of content) {
          if (!raw || typeof raw !== "object") continue;
          const b = raw as Record<string, unknown>;
          if (typeof b.startId !== "string" && typeof b.endId !== "string") continue;
          blocks.push(b);
        }
        if (blocks.length === 0) return null;
        const topic = typeof obj.topic === "string" ? obj.topic : null;
        const TONE = "#5fbfb0";
        return (
          <div className="rounded-lg p-2.5" style={{ background: `${TONE}0d`, border: `1px solid ${TONE}33` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ color: TONE, background: `${TONE}22` }}>DCP compression</span>
              {topic && <span className="text-[11px] font-mono" style={{ color: C.fg2 }}>{topic}</span>}
              <span className="text-[10px] font-mono" style={{ color: C.fg0 }}>{blocks.length} block{blocks.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-1">
              {blocks.map((b, i) => {
                const s = typeof b.startId === "string" ? b.startId : "—";
                const e = typeof b.endId === "string" ? b.endId : "—";
                const sum = typeof b.summary === "string" ? b.summary : "";
                return (
                  <div key={i} className="text-[11px] font-mono leading-relaxed">
                    <span style={{ color: TONE }}>{s} → {e}</span>
                    {sum ? <span style={{ color: C.fg1 }}> · {sum}</span> : <span style={{ color: C.fg0 }}> · block ref only</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {showMessagesTab && (
        <div className="flex-shrink-0 flex" style={{ borderBottom: `1px solid ${C.border}`, marginLeft: -6, marginBottom: 2 }}>
          <button style={tabStyle("messages")} onClick={() => setTab("messages")}>Messages{messages && messages.length > 1 ? ` (${messages.length})` : ""}</button>
          <button style={tabStyle("metadata")} onClick={() => setTab("metadata")}>Metadata</button>
        </div>
      )}

      {activeTab === "messages" && showMessagesTab && messages && (
        <div className="pt-1">
          <MessageList messages={messages} />
        </div>
      )}

      {activeTab === "metadata" && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
            <div style={{ color: C.fg0 }}>duration</div>
            <div style={{ color: C.fg2 }}>{fmt(span.duration_ms)}</div>
            {span.model && <><div style={{ color: C.fg0 }}>model</div><div style={{ color: C.fg2 }}>{span.model}</div></>}
            {span.input_tokens != null && <><div style={{ color: C.fg0 }}>input tokens</div><div style={{ color: C.fg2 }}>{span.input_tokens.toLocaleString()}</div></>}
            {span.output_tokens != null && <><div style={{ color: C.fg0 }}>output tokens</div><div style={{ color: C.fg2 }}>{span.output_tokens.toLocaleString()}</div></>}
            <div style={{ color: C.fg0 }}>status</div>
            <div style={{ color: isErr ? C.red : C.fg2 }}>{span.status}</div>
            <div style={{ color: C.fg0 }}>start</div>
            <div style={{ color: C.fg2 }}>{new Date(span.start_time_ms).toISOString().replace("T", " ").slice(0, 23)}</div>
            <div style={{ color: C.fg0 }}>end</div>
            <div style={{ color: C.fg2 }}>{span.end_time_ms ? new Date(span.end_time_ms).toISOString().replace("T", " ").slice(0, 23) : "—"}</div>
            <div style={{ color: C.fg0 }}>span id</div>
            <div style={{ color: C.fg0 }}>{span.id.slice(-12)}</div>
            {parentSpan && (
              <><div style={{ color: C.fg0 }}>parent</div>
              <div style={{ color: C.fg2 }} className="truncate" title={parentSpan.name}>
                <span className="font-mono">{parentSpan.name}</span>
                <span style={{ color: C.fg0, opacity: 0.6 }}> · {parentSpan.id.slice(-12)}</span>
              </div></>
            )}
            {children.length > 0 && (
              <><div style={{ color: C.fg0 }}>children</div>
              <div style={{ color: C.fg2 }} className="font-mono">{children.length}</div></>
            )}
            {span.attributes && (() => { try { const a = JSON.parse(span.attributes); return a["ai.provider.baseURL"] ? <><div style={{ color: C.fg0 }}>base url</div><div style={{ color: C.fg0 }}>{a["ai.provider.baseURL"]}</div></> : null; } catch { return null; } })()}
          </div>

          {span.attributes && (() => {
            try {
              const attrs: unknown = JSON.parse(span.attributes);
              if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
              const configObj: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(attrs)) {
                if (k === "ai.provider.headers" ||
                    k === "ai.request.thinking" || k === "ai.request.providerOptions" ||
                    k.startsWith("ai.settings.") || k.startsWith("ai.request.headers.") ||
                    (k.startsWith("gen_ai.request.") && k !== "gen_ai.request.model")) {
                  const label = k.replace("gen_ai.request.", "").replace("ai.provider.", "").replace("ai.request.", "").replace("ai.settings.", "settings.");
                  let parsed = v;
                  if (typeof v === "string") { try { parsed = JSON.parse(v); } catch {} }
                  if (label === "providerOptions" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    const parsedOptions = parsed as Record<string, unknown>;
                    const keys = Object.keys(parsedOptions);
                    if (keys.length === 1 && typeof parsedOptions[keys[0]] === "object") {
                      const inner = parsedOptions[keys[0]];
                      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
                        for (const [ik, iv] of Object.entries(inner)) {
                          configObj[ik] = iv;
                        }
                      }
                      continue;
                    }
                  }
                  configObj[label] = parsed;
                }
              }
              if (Object.keys(configObj).length === 0) return null;
              const previewVal = (v: unknown): string => {
                if (v === null) return "null";
                if (v === true || v === false) return String(v);
                if (typeof v === "string") return v.length > 25 ? v.slice(0, 25) + "\u2026" : v;
                if (typeof v === "number") return String(v);
                if (Array.isArray(v)) return `[${v.length}]`;
                if (v && typeof v === "object") {
                  const entries = Object.entries(v).slice(0, 3);
                  const inner = entries.map(([ik, iv]) => `${ik}: ${typeof iv === "object" ? (iv === null ? "null" : Array.isArray(iv) ? `[${iv.length}]` : "{...}") : previewVal(iv)}`).join(", ");
                  return entries.length < Object.keys(v).length ? `${inner}, \u2026` : inner;
                }
                return String(v);
              };
              const preview = Object.entries(configObj).map(([k, v]) => `${k}: ${previewVal(v)}`).join("  \u00B7  ");

              const providerName = (() => {
                const providerValue = Object.entries(attrs).find(([key]) => key === "ai.model.provider")?.[1];
                const p = typeof providerValue === "string" ? providerValue : undefined;
                if (!p) return "";
                const name = p.split(".")[0];
                return name.charAt(0).toUpperCase() + name.slice(1);
              })();
              const title = providerName ? `Provider Options (${providerName})` : "Provider Options";
              return <CollapsibleSection title={title} preview={preview} data={configObj} maxExpand={10} />;
            } catch { return null; }
          })()}

          {span.input_payload && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.fg1 }}>Input</div>
                <CopyButton text={tryJson(span.input_payload) ?? span.input_payload} />
              </div>
              <div className="p-2 rounded" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}` }}>
                <JsonView data={span.input_payload} />
              </div>
            </div>
          )}

          {span.output_payload && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.fg1 }}>Output</div>
                <CopyButton text={tryJson(span.output_payload) ?? span.output_payload} />
              </div>
              <div className="p-2 rounded" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}` }}>
                <JsonView data={span.output_payload} />
              </div>
            </div>
          )}

          {/* F-012: list child spans so users can navigate the tree from any node */}
          {children.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1" style={{ color: C.fg1 }}>Children ({children.length})</div>
              <div className="rounded p-2 space-y-0.5" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}` }}>
                {children
                  .slice()
                  .sort((a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0))
                  .map(c => {
                    const ci = typeInfo(c);
                    return (
                      <div key={c.id} className="flex items-center gap-2 text-[11px] font-mono">
                        <span style={{ color: ci.color }}>{ci.label}</span>
                        <span className="truncate flex-1" style={{ color: C.fg2 }} title={c.name}>{c.name}</span>
                        <span style={{ color: C.fg0, opacity: 0.7 }} className="whitespace-nowrap">{fmt(c.duration_ms)}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

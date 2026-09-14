import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { C } from "../utils/colors";
import { SPAN_TYPE_COLORS, SPAN_TYPE_LABELS, spanTypeFromRaw } from "../utils/span-colors";
import { fmt, tryJson, detectProvider } from "../utils/helpers";
import type { Span, SubAgent } from "../utils/types";
import { detectSubAgents } from "../api/agents";
import { Chevron } from "./Icons";
import { SubAgentBlock } from "./SubAgentBlock";
import { JsonView } from "./JsonView";
import { AnnotationChip, KIND_STYLES, SOURCE_GLYPH, annotationSourceLabel } from "./AnnotationChip";
import { InlineCreateForm } from "./TraceAnnotations";
import type { Annotation, AnnotationKind } from "../hooks/use-annotations";
import { DeepLinkedText } from "../utils/deep-links";
import { sendWorkshopMessage } from "../hooks/use-workshop-ws";
import { SpanDetail } from "./SpanDetail";

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

function typeInfo(span: Span): { color: string; label: string } {
  const t = spanTypeFromRaw(span.span_type, span);
  return { color: SPAN_TYPE_COLORS[t], label: SPAN_TYPE_LABELS[t] };
}

// F-003 contract preserved: TOOL_CALL spans rooting a sub-agent get the
// gold SUB_AGENT_ROOT badge. Only the lookup mechanism moved — to span-colors.
function inferSpanTypeForDisplay(span: Span, subAgents: SubAgent[]): { color: string; label: string } {
  if (span.span_type === "TOOL_CALL" && subAgents.some(s => s.root_span_id === span.id)) {
    return { color: SPAN_TYPE_COLORS.SUB_AGENT_ROOT, label: SPAN_TYPE_LABELS.SUB_AGENT_ROOT };
  }
  return typeInfo(span);
}

function SpanRow({ span, depth, minTime, totalDur, selected, flashing, onClick, onContextMenu, annotations, freshIds, onClearFresh, subAgents, chevron, childCount, onChevronClick }: {
  span: Span; depth: number; minTime: number; totalDur: number;
  selected: boolean; flashing: boolean; onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, span: Span) => void;
  annotations: Annotation[];
  freshIds: Set<string>;
  onClearFresh: (id: string) => void;
  subAgents: SubAgent[];
  chevron: "expanded" | "collapsed" | null;
  childCount: number;
  onChevronClick?: () => void;
}) {
  const info = inferSpanTypeForDisplay(span, subAgents);
  const color = info.color;
  const isErr = span.status === "ERROR";
  const leftPct = totalDur > 0 ? ((span.start_time_ms - minTime) / totalDur) * 100 : 0;
  const widthPct = totalDur > 0 ? Math.max((span.duration_ms / totalDur) * 100, 0.5) : 100;

  const subAgentIndex = subAgents.findIndex(s => s.root_span_id === span.id);
  const subAgent = subAgentIndex >= 0 ? subAgents[subAgentIndex] : null;
  let displayLabel = span.name;
  if (subAgent) {
    if (span.name === "task") {
      displayLabel = `Sub-agent: ${subAgent.subagent_name ?? `task ${subAgentIndex + 1}`}`;
    } else if (subAgent.subagent_name) {
      displayLabel = `${span.name}: ${subAgent.subagent_name}`;
    }
  }

  return (
    <div
      data-span-row={span.id}
      className="flex items-center cursor-pointer"
      style={{
        minHeight: 28,
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        background: flashing ? "rgba(96,165,250,0.15)" : selected ? "rgba(255,255,255,0.04)" : isErr ? "rgba(204,102,102,0.04)" : "transparent",
        borderLeft: flashing ? `2px solid #60a5fa` : selected ? `2px solid ${C.fg2}` : isErr ? `2px solid ${C.red}` : "2px solid transparent",
        transition: "background 0.4s ease, border-left 0.4s ease",
      }}
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, span); } : undefined}
    >
      <div className="flex items-center gap-1.5 flex-shrink-0" style={{ width: 220, paddingLeft: depth * 14 + 8, minWidth: 220 }}>
        {chevron !== null ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChevronClick?.(); }}
            title={chevron === "expanded" ? "Collapse subtree" : "Expand subtree"}
            aria-label={chevron === "expanded" ? "Collapse subtree" : "Expand subtree"}
            aria-expanded={chevron === "expanded"}
            style={{ width: 12, height: 12, padding: 0, background: "transparent", border: 0, color: C.fg1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <Chevron open={chevron === "expanded"} size={10} />
          </button>
        ) : (
          <span aria-hidden style={{ width: 12, height: 12, flexShrink: 0, display: "inline-block" }} />
        )}
        <span className="text-[10px] font-mono font-bold px-1 py-0.5 rounded" style={{ color: info.color, background: `${info.color}12` }}>
          {info.label}
        </span>
        {childCount > 0 && (
          <span
            className="text-[9px] font-mono px-1 py-0.5 rounded"
            style={{ color: C.fg1, background: "rgba(255,255,255,0.05)", lineHeight: 1.2 }}
            title={`${childCount} child span${childCount === 1 ? "" : "s"}`}
          >
            {childCount}
          </span>
        )}
        <span className="text-[11px] font-mono truncate" style={{ color: isErr ? C.red : C.fg3 }} title={displayLabel}>
          {displayLabel}
        </span>
        {annotations.map((a) => (
          <AnnotationChip
            key={a.id}
            annotation={a}
            arriving={freshIds.has(a.id)}
            onArrivalEnd={() => onClearFresh(a.id)}
            title={a.note ?? undefined}
          />
        ))}
      </div>
      <div className="flex-1 relative mx-2" style={{ height: 10 }}>
        <div className="absolute rounded-sm"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            top: 0,
            height: 10,
            backgroundColor: isErr ? C.red : color,
            boxShadow: isErr ? `0 0 8px ${C.red}80` : `0 0 8px ${color}80`,
            opacity: selected || flashing ? 1 : 0.88,
            minWidth: 2,
          }} />
      </div>
      <div className="flex-shrink-0 text-right pr-3" style={{ width: 55 }}>
        <span className="text-[10px] font-mono" style={{ color: C.fg0 }}>{fmt(span.duration_ms)}</span>
      </div>
    </div>
  );
}

export type SpanViewMode = "flat" | "nested";

function ViewModeToggle({ value, onChange }: { value: SpanViewMode; onChange: (mode: SpanViewMode) => void }) {
  return (
    <div
      className="inline-flex items-center rounded"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}
      role="group"
      aria-label="Span tree view mode"
    >
      {(["flat", "nested"] as const).map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className="text-[9px] uppercase tracking-wider font-medium transition-colors"
            style={{
              padding: "1px 6px",
              color: active ? C.fg5 : C.fg0,
              background: active ? "rgba(255,255,255,0.08)" : "transparent",
              borderRadius: 2,
              cursor: "pointer",
            }}
            aria-pressed={active}
            title={m === "flat" ? "Flat view — chronological list" : "Nested view — hierarchical tree"}
          >
            {m === "flat" ? "Flat" : "Nested"}
          </button>
        );
      })}
    </div>
  );
}

interface SpanTreeProps {
  spans: Span[];
  /** When set with `onSelectSpan`, selection is driven by the URL. */
  selectedSpanId?: string | null;
  onSelectSpan?: (spanId: string | null) => void;
  annotations?: Annotation[];
  freshIds?: Set<string>;
  onClearFresh?: (id: string) => void;
  onCreateAnnotation?: (input: { span_id?: string | null; kind: AnnotationKind; note?: string; source?: "user" | "claude-code" }) => Promise<Annotation | null>;
  onDeleteAnnotation?: (id: string) => Promise<void>;
  /** Flat (chronological list) vs nested (hierarchical tree) rendering. Defaults to "nested". */
  viewMode?: SpanViewMode;
  /** When set, viewMode is controlled by the parent (e.g. RunDetail). */
  onViewModeChange?: (mode: SpanViewMode) => void;
  /** When set, the in-tree SubAgentBlock section shows an "Open Sub-Agent →" button that dives into the agent. */
  onDiveIn?: (rootSpanId: string) => void;
}

interface ContextMenuState {
  spanId: string;
  x: number;
  y: number;
}

const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_FRESH_IDS = new Set<string>();

export function SpanTree({
  spans,
  selectedSpanId,
  onSelectSpan,
  annotations = EMPTY_ANNOTATIONS,
  freshIds = EMPTY_FRESH_IDS,
  onClearFresh = () => {},
  onCreateAnnotation,
  onDeleteAnnotation,
  viewMode: viewModeProp,
  onViewModeChange,
  onDiveIn,
}: SpanTreeProps) {
  const controlled = onSelectSpan !== undefined;
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = controlled ? (selectedSpanId ?? null) : internalSelectedId;
  const setSelectedId = useCallback((id: string | null) => {
    if (controlled) onSelectSpan?.(id);
    else setInternalSelectedId(id);
  }, [controlled, onSelectSpan]);
  const viewModeControlled = onViewModeChange !== undefined;
  const [internalViewMode, setInternalViewMode] = useState<SpanViewMode>("nested");
  const viewMode = viewModeControlled ? (viewModeProp ?? "nested") : internalViewMode;
  const setViewMode = useCallback((mode: SpanViewMode) => {
    if (viewModeControlled) onViewModeChange?.(mode);
    else setInternalViewMode(mode);
  }, [viewModeControlled, onViewModeChange]);
  const autoSelectedRunRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [addingForSpan, setAddingForSpan] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const runId = spans[0]?.run_id ?? null;
  const reportedSelectedId = selectedId && spans.some((s) => s.id === selectedId) ? selectedId : null;

  // Expand/collapse state. Reset ONLY on runId change (not on spans change) so
  // live updates within a run preserve user collapse choices — see F-004.1 spec.
  const [expanded, setExpanded] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    for (const s of spans) m.set(s.id, true);
    return m;
  });
  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Map(prev);
      next.set(id, !(next.get(id) ?? true));
      return next;
    });
  }, []);
  useEffect(() => {
    const m = new Map<string, boolean>();
    for (const s of spans) m.set(s.id, true);
    setExpanded(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reset on run switch only
  }, [runId]);

  useEffect(() => {
    if (controlled || !runId || autoSelectedRunRef.current === runId) return;
    autoSelectedRunRef.current = runId;
    setInternalSelectedId(spans[0]?.id ?? null);
  }, [controlled, runId, spans]);

  useEffect(() => {
    if (!runId) return;
    sendWorkshopMessage({ type: "ui_view", run_id: runId, span_id: reportedSelectedId });
  }, [runId, reportedSelectedId]);

  useEffect(() => {
    if (!runId) return;
    return () => sendWorkshopMessage({ type: "ui_view", run_id: runId, span_id: null });
  }, [runId]);

  // Deep-link receiver for uncontrolled trees (e.g. sub-agent drill-in).
  useEffect(() => {
    if (controlled) return;
    const spanIds = new Set(spans.map((s) => s.id));
    const handler = (ev: Event) => {
      const spanId = (ev as CustomEvent).detail?.spanId as string | undefined;
      if (!spanId || !spanIds.has(spanId)) return;
      setInternalSelectedId(spanId);
      setFlashId(spanId);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-span-row="${spanId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      window.setTimeout(() => setFlashId(null), 1500);
    };
    window.addEventListener("workshop:deep-link-span", handler);
    return () => window.removeEventListener("workshop:deep-link-span", handler);
  }, [controlled, spans]);

  useEffect(() => {
    if (!selectedSpanId) return;
    setFlashId(selectedSpanId);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-span-row="${selectedSpanId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timeout = window.setTimeout(() => setFlashId(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [selectedSpanId]);

  // Dismiss context menu on scroll / outside click / escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onEsc);
    };
  }, [contextMenu]);

  const annotationsBySpan = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations) {
      if (!a.span_id) continue;
      const arr = map.get(a.span_id) ?? [];
      arr.push(a);
      map.set(a.span_id, arr);
    }
    return map;
  }, [annotations]);

  const spanMap = new Map(spans.map(s => [s.id, s]));
  const children = new Map<string, Span[]>();
  const roots: Span[] = [];
  for (const s of spans) {
    if (!s.parent_span_id || !spanMap.has(s.parent_span_id)) roots.push(s);
    else { const c = children.get(s.parent_span_id) ?? []; c.push(s); children.set(s.parent_span_id, c); }
  }

  const subAgents = useMemo(() => detectSubAgents(spans), [spans]);

  const flat: { span: Span; depth: number }[] = [];
  function walk(span: Span, depth: number) {
    flat.push({ span, depth });
    for (const kid of children.get(span.id) ?? []) walk(kid, depth + 1);
  }
  for (const r of roots) walk(r, 0);

  const minTime = flat.length > 0 ? Math.min(...flat.map(f => f.span.start_time_ms)) : 0;
  const maxTime = flat.length > 0 ? Math.max(...flat.map(f => f.span.end_time_ms)) : 0;
  const totalDur = maxTime - minTime || 1;

  const selectedSpan = selectedId ? spanMap.get(selectedId) : null;

  // Recursive nested-DOM renderer (F-004.1): children render INSIDE the
  // parent's wrapper div, not as flat siblings. Wrapper div is load-bearing.
  const renderSpanExtras = (span: Span, depth: number, spanAnnotations: Annotation[]): React.ReactNode => {
    return (
      <>
        {addingForSpan === span.id && onCreateAnnotation && (
          <div style={{ padding: "4px 10px 6px", paddingLeft: depth * 14 + 40 }}>
            <InlineCreateForm
              compact
              onCancel={() => setAddingForSpan(null)}
              onSubmit={async ({ kind, note }) => {
                await onCreateAnnotation({ span_id: span.id, kind, note, source: "user" });
                setAddingForSpan(null);
              }}
            />
          </div>
        )}
        {selectedId === span.id && spanAnnotations.length > 0 && (
          <div style={{ padding: "4px 10px 6px", paddingLeft: depth * 14 + 40, display: "flex", flexDirection: "column", gap: 4 }}>
            {spanAnnotations.map((a) => {
              const st = KIND_STYLES[a.kind];
              return (
                <div key={a.id} style={{ padding: "7px 9px", border: `1px solid ${st.border}`, background: `linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015)), ${st.bg}`, borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 11, color: C.fg4, lineHeight: 1.45 }}>
                    <span style={{ color: C.fg0, fontSize: 10, marginRight: 6 }}>
                      {SOURCE_GLYPH[a.source]} {annotationSourceLabel(a.source)}
                    </span>
                    {a.note ? <DeepLinkedText text={a.note} /> : <em style={{ color: C.fg0 }}>(no note)</em>}
                  </div>
                  {onDeleteAnnotation && (
                    <button onClick={(e) => { e.stopPropagation(); onDeleteAnnotation(a.id); }} title="Delete" style={{ background: "transparent", border: 0, color: C.fg0, fontSize: 13, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const renderNode = (span: Span, depth: number): React.ReactNode => {
    const kids = children.get(span.id) ?? [];
    const hasChildren = kids.length > 0;
    const isExpanded = expanded.get(span.id) ?? true;
    const spanAnnotations = annotationsBySpan.get(span.id) ?? [];
    return (
      <div key={span.id}>
        <SpanRow
          span={span} depth={depth}
          minTime={minTime} totalDur={totalDur}
          selected={span.id === selectedId}
          flashing={span.id === flashId}
          onClick={() => setSelectedId(span.id === selectedId ? null : span.id)}
          onContextMenu={onCreateAnnotation ? (e, s) => setContextMenu({ spanId: s.id, x: e.clientX, y: e.clientY }) : undefined}
          annotations={spanAnnotations}
          freshIds={freshIds}
          onClearFresh={onClearFresh}
          subAgents={subAgents}
          chevron={hasChildren ? (isExpanded ? "expanded" : "collapsed") : null}
          childCount={kids.length}
          onChevronClick={hasChildren ? () => toggleExpand(span.id) : undefined}
        />
        {renderSpanExtras(span, depth, spanAnnotations)}
        {isExpanded && kids.map(kid => renderNode(kid, depth + 1))}
      </div>
    );
  };

  // Flat renderer (F-004.4): chronological list — no chevrons, no
  // expand/collapse wrapper, no child-count badge. Depth still drives
  // indentation so the original tree shape remains legible.
  const renderFlatRow = (span: Span, depth: number): React.ReactNode => {
    const spanAnnotations = annotationsBySpan.get(span.id) ?? [];
    return (
      <div key={span.id}>
        <SpanRow
          span={span} depth={depth}
          minTime={minTime} totalDur={totalDur}
          selected={span.id === selectedId}
          flashing={span.id === flashId}
          onClick={() => setSelectedId(span.id === selectedId ? null : span.id)}
          onContextMenu={onCreateAnnotation ? (e, s) => setContextMenu({ spanId: s.id, x: e.clientX, y: e.clientY }) : undefined}
          annotations={spanAnnotations}
          freshIds={freshIds}
          onClearFresh={onClearFresh}
          subAgents={subAgents}
          chevron={null}
          childCount={0}
        />
        {renderSpanExtras(span, depth, spanAnnotations)}
      </div>
    );
  };

  if (flat.length === 0) return <div style={{ color: C.fg1 }}>No spans</div>;

  return (
    <div className="flex flex-col h-full rounded-lg" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex flex-1 min-h-0">
        {/* Left: span list */}
        <div className="overflow-auto sb" style={{ flex: selectedSpan ? "0 0 50%" : "1 1 auto", borderRight: selectedSpan ? `1px solid ${C.border}` : "none" }}>
          {subAgents.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(212,168,87,0.04)" }} data-testid="span-tree-subagent-block">
              <span className="text-[9px] uppercase tracking-wider font-medium" style={{ color: "#d4a857" }}>Sub-agents</span>
              {subAgents.map((agent) => (
                <SubAgentBlock key={agent.root_span_id} agent={agent} spans={spans} onDiveIn={onDiveIn} />
              ))}
            </div>
          )}
          {/* Header */}
          <div className="flex items-center px-2 py-1.5 sticky top-0 z-10" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2" style={{ width: 220 }}>
              <div className="text-[9px] uppercase tracking-wider font-medium" style={{ color: C.fg0 }}>Span</div>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </div>
            <div className="flex-1 text-[9px] uppercase tracking-wider font-medium" style={{ color: C.fg0 }}>Timeline</div>
            <div className="text-[9px] uppercase tracking-wider font-medium text-right pr-3" style={{ color: C.fg0, width: 55 }}>Dur</div>
          </div>
          {viewMode === "nested"
            ? roots.map(root => renderNode(root, 0))
            : flat.map(({ span, depth }) => renderFlatRow(span, depth))
          }
        </div>
        {contextMenu && onCreateAnnotation && (
          <SpanContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onMarkKind={async (kind) => {
              await onCreateAnnotation({ span_id: contextMenu.spanId, kind, source: "user" });
              setContextMenu(null);
            }}
            onAddNote={() => {
              setAddingForSpan(contextMenu.spanId);
              setContextMenu(null);
            }}
          />
        )}

        {/* Right: detail */}
        {selectedSpan && (
          <div className="overflow-auto sb" style={{ flex: "0 0 50%", background: C.surface }}>
            <SpanDetail span={selectedSpan} allSpans={spans} />
          </div>
        )}
      </div>
    </div>
  );
}

function SpanContextMenu({ x, y, onClose, onMarkKind, onAddNote }: {
  x: number; y: number; onClose: () => void;
  onMarkKind: (kind: AnnotationKind) => void | Promise<void>;
  onAddNote: () => void;
}) {
  // Clamp within viewport
  const clampedX = Math.min(x, window.innerWidth - 230);
  const clampedY = Math.min(y, window.innerHeight - 180);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: clampedY, left: clampedX, zIndex: 50,
        minWidth: 210,
        padding: "4px 0",
        background: "#121214",
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        fontSize: 12,
        color: C.fg3,
      }}
    >
      <div style={{ padding: "4px 12px 2px", fontSize: 10, textTransform: "uppercase", color: C.fg0, letterSpacing: "0.04em" }}>
        Annotate span
      </div>
      {(["issue", "good", "note"] as AnnotationKind[]).map((kind) => {
        const s = KIND_STYLES[kind];
        return (
          <button
            key={kind}
            onClick={() => { if (kind === "note") onAddNote(); else onMarkKind(kind); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "6px 12px", background: "transparent", border: 0, color: C.fg3,
              cursor: "pointer", textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ width: 14, textAlign: "center", color: s.fg, fontWeight: 700 }}>{s.icon}</span>
            <span style={{ flex: 1 }}>{kind === "note" ? "Add note…" : `Mark as ${kind}`}</span>
          </button>
        );
      })}
    </div>
  );
}

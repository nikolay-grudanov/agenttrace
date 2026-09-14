import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HelpCircle, ChevronDown } from "lucide-react";
import { C } from "../utils/colors";
import { ago, fmt } from "../utils/helpers";
import { Dots } from "./Icons";
import { ToolCallPill } from "./ToolCallPill";
import { Markdown } from "./Markdown";
import type { Run } from "../utils/types";
import { buildConvoEvents } from "./convo-events";
import { useWorkshopEvent } from "../hooks/use-workshop-ws";
import { useConversationDetail } from "../hooks/use-runs";
import { useConvoStatistics } from "../hooks/use-convo-statistics";
import { useConvoCompressions } from "../hooks/use-convo-compressions";
import { StatsTable, StatsRow, StatsLabel, StatsValue, StatsCaption } from "./StatsTable";

/**
 * F-012: cross-run Convo Statistics panel. Shows total wall-clock, span and
 * tool counts, token coverage (X/Y spans with token counts), total tokens and
 * per-model rollup. The panel is intentionally compact: numbers + small tables,
 * no histograms (those come in a follow-up if requested).
 *
 * Disclaimers: surfaces data-quality limitations surfaced by the F-012 review
 * (e.g., end-time coverage, error detection). Numbers are computed server-side
 * by `getConvoStatistics` in `src/db.ts`.
 */
function ConvoStatsPanel({ convoId }: { convoId: string }) {
  const stats = useConvoStatistics(convoId);
  const [expanded, setExpanded] = useState(true);

  if (stats.isLoading) {
    return (
      <div className="text-[11px] font-mono px-3 py-2 rounded" style={{ background: "rgba(255,255,255,0.025)", color: C.fg0 }}>
        Loading conversation statistics…
      </div>
    );
  }
  if (stats.isError || !stats.data) {
    return (
      <div className="text-[11px] font-mono px-3 py-2 rounded" style={{ background: "rgba(204,102,102,0.06)", color: C.red }}>
        Failed to load conversation statistics: {stats.error instanceof Error ? stats.error.message : "unknown"}
      </div>
    );
  }

  const s = stats.data;
  const noData = s.run_count === 0 && s.span_count === 0;
  const errors = s.error_span_count;
  const errColor = errors > 0 ? C.red : C.fg2;
  const tokenPct = s.span_count > 0 ? Math.round((s.span_with_tokens / s.span_count) * 100) : 0;

  return (
    <div className="rounded-lg" style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 rounded" style={{ background: "rgba(255,255,255,0.09)", color: C.fg1, lineHeight: "16px" }}>
            Convo Stats
          </span>
          <span className="text-[11px] font-mono" style={{ color: C.fg2 }}>
            {s.run_count} run{s.run_count !== 1 ? "s" : ""} · {s.span_count} span{s.span_count !== 1 ? "s" : ""}
          </span>
          {(s.tokens.in > 0 || s.tokens.out > 0) && (
            <span className="text-[11px] font-mono" style={{ color: C.fg1 }}>
              · {(s.tokens.in + s.tokens.out).toLocaleString()} tokens
            </span>
          )}
          {errors > 0 && (
            <span className="text-[11px] font-mono" style={{ color: C.red }}>
              · {errors} error{errors !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 120ms" }}>
          <ChevronDown size={14} />
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1">
          {noData ? (
            <div className="text-[11px]" style={{ color: C.fg0 }}>
              No spans available for this conversation.
            </div>
          ) : (
            <div>
              {/* Totals + tokens as one ruled table */}
              <StatsTable>
                <tbody>
                  <StatsRow>
                    <StatsLabel>duration</StatsLabel>
                    <StatsValue>{fmt(s.wall_clock_ms)}</StatsValue>
                  </StatsRow>
                  <StatsRow>
                    <StatsLabel>LLM calls</StatsLabel>
                    <StatsValue>{s.llm_span_count}</StatsValue>
                  </StatsRow>
                  <StatsRow>
                    <StatsLabel>tool calls</StatsLabel>
                    <StatsValue>{s.tool_span_count}</StatsValue>
                  </StatsRow>
                  <StatsRow>
                    <StatsLabel>sub-agents</StatsLabel>
                    <StatsValue>{s.subagent_count}</StatsValue>
                  </StatsRow>
                  <StatsRow>
                    <StatsLabel>errors</StatsLabel>
                    <StatsValue color={errColor}>{errors}</StatsValue>
                  </StatsRow>
                  <StatsRow>
                    <StatsLabel>tokens</StatsLabel>
                    <StatsValue>
                      {s.tokens.in.toLocaleString()} in <span style={{ color: C.fg0 }}>/</span> {s.tokens.out.toLocaleString()} out
                    </StatsValue>
                  </StatsRow>
                  <StatsRow last>
                    <td className="py-[5px] text-[10px] leading-snug" style={{ color: C.fg0 }} colSpan={2}>
                      covered: {s.span_with_tokens}/{s.span_count} spans ({tokenPct}%).
                      {tokenPct < 100 && " Totals undercount spans that didn't report tokens."}
                    </td>
                  </StatsRow>
                </tbody>
              </StatsTable>

              {/* Per-model rollup */}
              {s.by_model.length > 0 && (
                <>
                  <StatsCaption>By model</StatsCaption>
                  <StatsTable>
                    <tbody>
                      {s.by_model.map((m, i) => (
                        <StatsRow key={m.model} last={i === s.by_model.length - 1}>
                          <StatsLabel title={m.model} max={220}>{m.model}</StatsLabel>
                          <StatsValue>{(m.in + m.out).toLocaleString()}</StatsValue>
                        </StatsRow>
                      ))}
                    </tbody>
                  </StatsTable>
                </>
              )}

              {/* Per-run rollup */}
              {s.runs.length > 0 && (
                <>
                  <StatsCaption>Per-run</StatsCaption>
                  <StatsTable>
                    <tbody>
                      {s.runs.map((r, i) => (
                        <StatsRow key={r.id} last={i === s.runs.length - 1}>
                          <StatsLabel title={r.event_name ?? r.id} max={180}>{r.event_name ?? r.id}</StatsLabel>
                          <StatsValue className="pr-4">{fmt(r.wall_clock_ms)}</StatsValue>
                          <StatsValue>{(r.tokens.in + r.tokens.out).toLocaleString()}</StatsValue>
                        </StatsRow>
                      ))}
                    </tbody>
                  </StatsTable>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * F-021: opencode-dcp compression feed — aggregated stats plus the numbered
 * list of every compression in the conversation (topics, token deltas, and
 * what the agent kept in each summary). Hidden entirely when the convo has
 * no compressions. Token deltas come from DCP's own chat notifications and
 * are exact; entries without a captured notification show the topic and
 * summaries but no numbers.
 */
function DcpCompressionsPanel({ convoId }: { convoId: string }) {
  const q = useConvoCompressions(convoId);
  const [expanded, setExpanded] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (q.isLoading) return null;
  if (q.isError || !q.data) {
    return (
      <div className="text-[11px] font-mono px-3 py-2 rounded" style={{ background: "rgba(204,102,102,0.06)", color: C.red }}>
        Failed to load compression report: {q.error instanceof Error ? q.error.message : "unknown"}
      </div>
    );
  }
  const d = q.data;
  if (d.total === 0) return null;

  const TONE = "#5fbfb0";
  const t = d.totals;
  const hasDeltas = t.removed_tokens > 0 || t.summary_tokens > 0;

  return (
    <div className="rounded-lg" style={{ background: "rgba(255,255,255,0.025)", border: `1px solid ${C.border}` }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 rounded" style={{ background: `${TONE}1a`, color: TONE, lineHeight: "16px" }}>
            DCP
          </span>
          <span className="text-[11px] font-mono" style={{ color: C.fg2 }}>
            {d.total} compression{d.total !== 1 ? "s" : ""}
          </span>
          {hasDeltas && (
            <span className="text-[11px] font-mono" style={{ color: C.fg1 }}>
              · −{t.removed_tokens.toLocaleString()} removed · +{t.summary_tokens.toLocaleString()} summary
            </span>
          )}
          {t.net_tokens > 0 && (
            <span className="text-[11px] font-mono" style={{ color: TONE }}>
              · net −{t.net_tokens.toLocaleString()} tok
            </span>
          )}
        </div>
        <span style={{ display: "inline-flex", transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 120ms" }}>
          <ChevronDown size={14} />
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {hasDeltas && (
            <StatsTable>
              <tbody>
                <StatsRow>
                  <StatsLabel>tokens removed</StatsLabel>
                  <StatsValue>−{t.removed_tokens.toLocaleString()}</StatsValue>
                </StatsRow>
                <StatsRow>
                  <StatsLabel>tokens in summaries</StatsLabel>
                  <StatsValue>+{t.summary_tokens.toLocaleString()}</StatsValue>
                </StatsRow>
                <StatsRow>
                  <StatsLabel>net context saved</StatsLabel>
                  <StatsValue color={TONE}>−{t.net_tokens.toLocaleString()}</StatsValue>
                </StatsRow>
                <StatsRow>
                  <StatsLabel>compressed</StatsLabel>
                  <StatsValue>
                    {t.messages.toLocaleString()} message{t.messages === 1 ? "" : "s"}
                    {t.tools > 0 ? ` · ${t.tools.toLocaleString()} tool${t.tools === 1 ? "" : "s"}` : ""}
                  </StatsValue>
                </StatsRow>
                <StatsRow last>
                  <td className="py-[5px] text-[10px] leading-snug" style={{ color: C.fg0 }} colSpan={2}>
                    Deltas parsed from DCP chat notifications — exact when captured.
                  </td>
                </StatsRow>
              </tbody>
            </StatsTable>
          )}

          {/* The feed: every compression, numbered like DCP's own #N */}
          <div className="space-y-1">
            {d.compressions.map(c => {
              const open = openIdx === c.index;
              return (
                <div key={c.span_id} className="rounded" style={{ border: `1px solid ${open ? `${TONE}44` : C.border}`, background: open ? `${TONE}08` : "rgba(255,255,255,0.015)" }}>
                  <button
                    type="button"
                    onClick={() => setOpenIdx(open ? null : c.index)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="text-[10px] font-mono font-medium shrink-0" style={{ color: TONE }}>#{c.index}</span>
                    <span className="text-[11px] font-mono truncate" style={{ color: C.fg3 }}>
                      {c.topic ?? "(no topic)"}
                    </span>
                    <span className="ml-auto flex items-center gap-2 shrink-0">
                      {c.removed_tokens != null && (
                        <span className="text-[10px] font-mono" style={{ color: C.fg0 }}>
                          −{c.removed_tokens.toLocaleString()} / +{(c.summary_tokens ?? 0).toLocaleString()}
                        </span>
                      )}
                      {c.messages_compressed != null && (
                        <span className="text-[10px] font-mono" style={{ color: C.fg0 }}>
                          {c.messages_compressed} msg{c.tools_compressed != null ? ` +${c.tools_compressed} tools` : ""}
                        </span>
                      )}
                      <span className="text-[10px] font-mono" style={{ color: C.fg0 }}>{ago(c.started_at)}</span>
                      <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 120ms" }} />
                    </span>
                  </button>
                  {open && (
                    <div className="px-2.5 pb-2 space-y-1.5">
                      {c.blocks.map((b, i) => (
                        <div key={`${c.span_id}-b${i}`}>
                          {(b.start_id || b.end_id) && (
                            <div className="text-[9px] font-mono mb-0.5" style={{ color: C.fg0 }}>
                              {b.start_id ?? "?"} → {b.end_id ?? "?"}
                            </div>
                          )}
                          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words" style={{ color: C.fg2 }}>
                            {b.summary || "(empty summary)"}
                          </pre>
                        </div>
                      ))}
                      <div className="text-[9px] font-mono" style={{ color: C.fg0 }}>
                        run {c.run_id.slice(0, 8)}… · {fmt(c.duration_ms)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationHeader({ runCount }: { runCount: number }) {
  return (
    <div className="text-[11px] font-mono inline-flex items-center gap-1.5" style={{ color: C.fg1 }}>
      <span>conversation</span>
      <span className="relative group inline-flex items-center">        <HelpCircle size={13} style={{ color: C.fg0, cursor: "help" }} />
        <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover:block">
          <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed whitespace-nowrap shadow-xl"
            style={{ background: C.elevated, border: `1px solid ${C.borderLight}`, color: C.fg3 }}>
            Conversation groups separate runs that share the same <span className="font-mono" style={{ color: C.fg4 }}>convo_id</span>
          </div>
        </div>
      </span>
      <span style={{ color: C.fg0 }}>&middot;</span>
      <span>{runCount} run{runCount !== 1 ? "s" : ""}</span>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end px-4 pt-5 pb-1">
      <div className="max-w-[65%] px-3.5 py-2.5 rounded-2xl rounded-br-md" style={{ background: C.user }}>
        <div className="relative">
          <pre className="text-sm leading-relaxed font-sans whitespace-pre-wrap" style={{ color: C.fg3 }}>
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

function TurnDivider({ index, run, onOpen, onHover }: { index: number; run: Run; onOpen: () => void; onHover: (hovering: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-6 pb-2">
      <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
      <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: C.fg1, background: "rgba(255,255,255,0.04)" }}>
        run {index + 1}
      </span>
      <span className="text-[10px]" style={{ color: C.fg0 }}>{ago(run.started_at)}</span>
      <button
        className="text-[10px] font-mono px-2 py-0.5 rounded transition-colors"
        style={{ color: C.fg1, background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.08)` }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; onHover(true); }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; onHover(false); }}
        onClick={onOpen}
      >
        open &rarr;
      </button>
      <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
    </div>
  );
}

export function ConvoDetail({ convoId, onOpenTurn }: { convoId: string; onOpenTurn?: (runId: string) => void }) {
  const queryClient = useQueryClient();
  const { turns, runIds, isLoading, isError } = useConversationDetail(convoId);
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colorMap = useMemo(() => new Map<string, string>(), []);

  useWorkshopEvent("spans", () => {
    void queryClient.invalidateQueries({ queryKey: ["conversation-runs", convoId] });
    for (const runId of runIds) {
      void queryClient.invalidateQueries({ queryKey: ["run-detail", runId] });
    }
  });
  useWorkshopEvent("live", () => {
    for (const runId of runIds) {
      void queryClient.invalidateQueries({ queryKey: ["run-detail", runId] });
    }
  });

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const events = useMemo(() => buildConvoEvents(turns), [turns]);

  if (isLoading) return <div className="flex items-center justify-center h-full gap-2" style={{ color: C.fg1 }}>Loading <Dots /></div>;
  if (isError) return <div className="flex items-center justify-center h-full" style={{ color: C.fg1 }}>Could not load conversation</div>;
  if (turns.length === 0) return <div className="flex items-center justify-center h-full" style={{ color: C.fg1 }}>No runs found</div>;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
        <ConversationHeader runCount={turns.length} />
      </div>

      {/* F-012: cross-run convo statistics — collapsible panel below the header. */}
      <div className="flex-shrink-0 px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
        <ConvoStatsPanel convoId={convoId} />
        {/* F-021: opencode-dcp compression feed (stats + numbered entries). */}
        <div className="mt-2">
          <DcpCompressionsPanel convoId={convoId} />
        </div>
      </div>

      {/* Event stream */}
      <div ref={scrollRef} className="flex-1 overflow-auto sb pb-24">
        {events.map((evt, i) => {
          const turnIdx = evt.turnIndex;
          const dimmed = hoveredTurn !== null && turnIdx !== hoveredTurn;

          if (evt.type === "turn_start") {
            return (
              <div key={`td${i}`} style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 0.15s" }}>
                <TurnDivider index={evt.turnIndex} run={evt.run}
                  onOpen={() => onOpenTurn?.(evt.run.id)}
                  onHover={(h) => setHoveredTurn(h ? evt.turnIndex : null)} />
              </div>
            );
          }

          if (evt.type === "user_msg") {
            return (
              <div key={`um${i}`} style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 0.15s" }}>
                <UserMessage content={evt.content} />
              </div>
            );
          }

          if (evt.type === "tool_group") {
            return (
              <div key={`tg${i}`} className="flex flex-wrap gap-1.5 px-4 py-1" style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 0.15s" }}>
                {evt.spans.map(s => (
                  <ToolCallPill key={s.id} span={s} colorMap={colorMap} />
                ))}
              </div>
            );
          }

          if (evt.type === "llm_out") {
            return (
              <div key={`lo${i}`} className="max-w-[85%] px-4 py-2" style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 0.15s" }}>
                <div className="text-message leading-relaxed" style={{ color: C.fg3 }}>
                  <Markdown>{evt.content}</Markdown>
                </div>
              </div>
            );
          }

          if (evt.type === "active") {
            return (
              <div key={`act${i}`} className="px-4 py-2 text-[11px] font-mono" style={{ opacity: dimmed ? 0.35 : 1, transition: "opacity 0.15s", color: C.fg0 }}>
                running <Dots />
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

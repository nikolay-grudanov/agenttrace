import { getRunWithSpans } from "../db";
import { extractContext } from "../replay";
import { contentToText, renderMarkdown, type ExportShape } from "./html-export";

export async function loadExportShape(runId: string): Promise<ExportShape> {
  const { run, spans } = getRunWithSpans(runId);
  if (!run) {
    throw new Error("Run not found");
  }

  const runAny = run as Record<string, unknown>;
  const startedAt = typeof runAny.started_at === "number" ? runAny.started_at : Date.now();
  const updatedAt = typeof runAny.last_updated_at === "number" ? runAny.last_updated_at : startedAt;

  let model: string | undefined;
  let provider: string | undefined;

  const metadataRaw = runAny.metadata;
  if (typeof metadataRaw === "string" && metadataRaw) {
    try {
      const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
      if (typeof metadata.model === "string") model = metadata.model;
      if (typeof metadata.provider === "string") provider = metadata.provider;
    } catch {
      // ignore non-JSON metadata
    }
  }

  if (!model) {
    const firstLlm = spans.find((s: any) => s.span_type?.includes("LLM") && (s as any).model);
    if (firstLlm) model = (firstLlm as any).model;
  }

  if (!provider) {
    provider = "openai";
  }

  const ctx = extractContext(spans);

  const messages: ExportShape["messages"] = ctx.messages.map((m: any) => ({
    role: String(m.role ?? "assistant") as ExportShape["messages"][number]["role"],
    content: contentToText(m.content),
  }));

  // Append reasoning from any LLM span as a <details> block on the last assistant message
  const allLLMs = spans.filter((s: any) => s.span_type?.includes("LLM"));
  for (const span of allLLMs) {
    if (!span.attributes) continue;
    let attrs: Record<string, unknown> | null = null;
    try {
      attrs = JSON.parse(span.attributes) as Record<string, unknown>;
    } catch {
      continue;
    }
    const reasoning = attrs?.reasoning;
    if (typeof reasoning === "string" && reasoning.trim()) {
      const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
      if (lastAssistantIdx >= 0) {
        const rendered = renderMarkdown(reasoning);
        messages[lastAssistantIdx].content +=
          `\n\n<details><summary>Reasoning</summary>${rendered}</details>`;
      }
    }
  }

  return {
    title: String(
      // F-028: a user-given `display_name` (set via PATCH /api/runs/:id)
      // wins; otherwise the upstream `name`; otherwise a short id slice.
      // Mirrors `runDisplayTitle()` in the React UI so the exported HTML
      // matches what the user sees in the sidebar.
      (typeof runAny.display_name === "string" && runAny.display_name.trim()
        ? runAny.display_name
        : null) ??
        (typeof runAny.name === "string" && runAny.name.trim() ? runAny.name : null) ??
        runId.slice(0, 8),
    ),
    display_name: typeof runAny.display_name === "string" ? runAny.display_name : null,
    event_name: typeof runAny.event_name === "string" ? runAny.event_name : null,
    model,
    provider,
    createdAt: startedAt,
    updatedAt: updatedAt,
    messages,
  };
}

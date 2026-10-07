import { apiJson, jsonInit } from "./request";

// AnnotationSource matches the server's enum in src/db/schema.ts:annotations.source
// ("user" | "opencode"). Per F-002, Claude Code / Codex are out — OpenCode-only.
export type AnnotationKind = "issue" | "good" | "note";
export type AnnotationSource = "user" | "opencode";

export interface Annotation {
  id: string;
  run_id: string;
  span_id: string | null;
  kind: AnnotationKind;
  note: string | null;
  source: AnnotationSource;
  created_at: number;
}

export interface AnnotationBroadcast {
  op: "insert" | "delete";
  run_id: string;
  span_id: string | null;
  annotation: Annotation;
}

export async function listAnnotations(runId: string): Promise<Annotation[]> {
  return apiJson<Annotation[]>(`/api/annotations?run_id=${encodeURIComponent(runId)}`);
}

export async function createAnnotation(input: {
  run_id: string;
  span_id?: string | null;
  kind: AnnotationKind;
  note?: string | null;
  source?: AnnotationSource;
}): Promise<Annotation> {
  return apiJson<Annotation>("/api/annotations", jsonInit("POST", {
    run_id: input.run_id,
    span_id: input.span_id ?? null,
    kind: input.kind,
    note: input.note ?? null,
    source: input.source ?? "user",
  }));
}

export async function deleteAnnotation(id: string): Promise<void> {
  await apiJson(`/api/annotations/${encodeURIComponent(id)}`, jsonInit("DELETE"));
}

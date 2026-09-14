// F-021: cross-run opencode-dcp compression report endpoint.
import { apiJson } from "./request";

export interface ConvoCompressionBlock {
  start_id: string | null;
  end_id: string | null;
  summary: string;
}

export interface ConvoCompression {
  span_id: string;
  run_id: string;
  index: number;
  topic: string | null;
  started_at: number;
  duration_ms: number;
  blocks: ConvoCompressionBlock[];
  messages_compressed: number | null;
  tools_compressed: number | null;
  removed_tokens: number | null;
  summary_tokens: number | null;
}

export interface ConvoCompressions {
  convo_id: string;
  total: number;
  totals: {
    removed_tokens: number;
    summary_tokens: number;
    net_tokens: number;
    messages: number;
    tools: number;
  };
  compressions: ConvoCompression[];
}

export function getConvoCompressions(convoId: string): Promise<ConvoCompressions> {
  return apiJson<ConvoCompressions>(`/api/convo/${encodeURIComponent(convoId)}/compressions`);
}

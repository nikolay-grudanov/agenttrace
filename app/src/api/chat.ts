import { apiJson, apiJsonOrNull, jsonInit } from "./request";

type Role = "user" | "assistant";

// OpenCode-sidepanel agent API (F-006). These wire types are shared between the
// standalone Claude-flavored names kept for historical reasons and the actual
// runtime (which is OpenCode-only — see src/agent-chat.ts:AgentProviderId). The
// rename to *Agent* types is deferred to F-030 (F-002 keeps them as-is to keep
// this commit small and reversible).
export interface ClaudeChatMessageBlock =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input_preview?: string; output_preview?: string; ok?: boolean }
  | { type: "thinking"; text: string };

export interface ClaudeChatMessage {
  id: string;
  role: Role;
  content: string;
  blocks?: ClaudeChatMessageBlock[];
  timestamp: string | null;
  error?: string;
}

export interface ClaudeSessionSummary {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  last_prompt: string | null;
  preview: string | null;
  cwd?: string;
}

export interface ClaudeSessionDetail extends ClaudeSessionSummary {
  messages: ClaudeChatMessage[];
}

export interface SendAgentMessageResponse {
  session_id?: string;
  session?: ClaudeSessionDetail;
  text?: string;
}

export async function listAgentSessions(): Promise<ClaudeSessionSummary[]> {
  return apiJsonOrNull<ClaudeSessionSummary[]>("/api/agent/sessions").then((sessions) => sessions ?? []);
}

export async function getAgentSession(id: string): Promise<ClaudeSessionDetail> {
  return apiJson<ClaudeSessionDetail>(`/api/agent/sessions/${encodeURIComponent(id)}`);
}

export async function getAgentLoadout(): Promise<AgentLoadout | null> {
  return apiJsonOrNull<AgentLoadout>("/api/agent/loadout");
}

export async function sendAgentMessage(body: {
  content: string;
  session_id: string | null;
  run_id: string | null;
  client_message_id: string;
}): Promise<SendAgentMessageResponse> {
  return apiJson<SendAgentMessageResponse>("/api/agent/messages", jsonInit("POST", body));
}

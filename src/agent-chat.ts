import fs from "fs";
import os from "os";
import path from "path";

export type AgentProviderId = "opencode";
export type AgentAnnotationSource = "opencode";

export interface AgentLoadout {
  tools: string[];
  mcps: string[];
  skills: string[];
  plugins: string[];
  slash_commands?: string[];
  model?: string;
}

export type AgentStreamEvent =
  | { type: "provider_session"; sessionId: string }
  | ({ type: "loadout" } & AgentLoadout)
  | { type: "text"; content: string }
  | { type: "status"; content: string }
  | { type: "error"; content: string }
  | { type: "tool_start"; id: string; name: string; input_preview?: string }
  | { type: "tool_finish"; id: string; ok: boolean; output_preview?: string }
  | { type: "thinking_delta"; content: string }
  | { type: "subagent_start"; parent_id: string; subagent: string }
  | { type: "permission_denied"; tool: string; reason: string }
  | { type: "usage"; input_tokens?: number; output_tokens?: number; cost_usd?: number }
  | { type: "done" };

export interface AgentCliChatInput {
  backendUrl: string;
  content: string;
  cwd: string;
  runId?: string | null;
  sessionId?: string | null;
  userMessageId?: string | null;
  resumeSessionId?: string | null;
  abortSignal?: AbortSignal;
}

export interface AgentCliChatHandlers {
  onEvent?(event: AgentStreamEvent): void;
  onProviderSession(sessionId: string): void;
  onText(content: string): void;
  onStatus(status: string): void;
  onError?(content: string): void;
}

export interface AgentCliChatResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

export const AGENTTRACE_MCP_TOOLS = [
  {
    name: "get_current_run",
    description: "resolve the focused Workshop run and selected span",
  },
  {
    name: "query_traces",
    description: "run read-only SQL over local trace tables",
  },
  {
    name: "get_span_payload",
    description: "read raw input or output payload slices for a span",
  },
  {
    name: "annotate",
    description: "create durable run or span annotations",
  },
  {
    name: "get_run_outline",
    description: "summarize a run's structure before reading payloads",
  },
  {
    name: "ask_agent",
    description: "ask the captured agent context about a trace",
  },
  {
    name: "replay_run",
    description: "replay a run through the normal local agent replay flow",
  },
  {
    name: "search_run",
    description: "search a run's span payloads, attributes, and live events",
  },
  {
    name: "get_span_context",
    description: "read nearby span skeletons around a span of interest",
  },
  {
    name: "show_in_ui",
    description: "open runs, filters, or drafted notes in the Workshop UI",
  },
] as const;

const STATE_PATH = path.join(os.homedir(), ".raindrop", "agent-provider.json");

export function getAgentProvider(): AgentProviderId {
  const envProvider = parseAgentProvider(process.env.AGENTTRACE_WORKSHOP_AGENT_PROVIDER);
  if (envProvider) return envProvider;
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as { provider?: unknown };
    return parseAgentProvider(parsed.provider) ?? "opencode";
  } catch {
    return "opencode";
  }
}

export function setAgentProvider(provider: AgentProviderId): AgentProviderId {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ provider, updated_at: new Date().toISOString() }, null, 2) + "\n");
  return provider;
}

export function parseAgentProvider(value: unknown): AgentProviderId | null {
  return value === "opencode" ? value : null;
}

export function defaultAgentLoadout(_provider: AgentProviderId): AgentLoadout {
  return {
    tools: AGENTTRACE_MCP_TOOLS.map((tool) => `workshop.${tool.name}`),
    mcps: ["workshop"],
    skills: [],
    plugins: [],
    slash_commands: ["/clear", "/trace"],
  };
}

export function agentProviderLabel(_provider: AgentProviderId): string {
  return "OpenCode";
}

export function agentAnnotationSource(_provider: AgentProviderId): AgentAnnotationSource {
  return "opencode";
}

export interface WorkshopSidepanelPromptInput {
  provider: AgentProviderId;
  localMcpName: string;
  runId?: string | null;
}

export function workshopSidepanelPrompt(input: WorkshopSidepanelPromptInput): string {
  return [
    ...baseSidepanelInstructions(input.localMcpName),
    ...prioritizationInstructions(),
    providerCapabilities(),
    runInstruction(input.runId),
  ].join(" ");
}

function baseSidepanelInstructions(localMcpName: string): string[] {
  return [
    "You are replying inside the Raindrop Workshop sidepanel.",
    "Raindrop Workshop is the local trace-debugger UI and daemon for inspecting agent runs, spans, payloads, annotations, and replays.",
    "You are the sidepanel coding assistant, not the captured agent whose trace is being inspected, unless a tool explicitly continues captured agent context.",
    "Your stdout is streamed directly into the Workshop chat UI.",
    "Use normal assistant text as your final answer. Markdown is supported.",
    `The local Workshop MCP server is configured as ${localMcpName}; its tool descriptions and schemas are authoritative, so prefer them over remembered parameter shapes.`,
    "For every MCP tool call, use the exact argument names and types from that tool's input schema; do not substitute aliases such as id when the schema requires issue_id, event_id, run_id, or span_id.",
    "Before searching traces or importing from production for broad requests, first make sure you understand the problem the user is trying to solve and which local agent/codebase is relevant; inspect the local project context when that will help choose the right events, users, signals, or trace queries.",
    "When you import, identify, or discuss a concrete trace or span, prefer showing it in the Workshop UI as well as explaining it, unless the user is clearly asking only for text.",
  ];
}

function prioritizationInstructions(): string[] {
  return [
    `Treat open-ended prioritization questions like "what should I work on today?", "what needs attention?", or "where should I focus?" as requests to gather context before answering.`,
    "For those questions, first use the active workspace, conversation context, and available MCPs.",
    "Do not answer that you lack visibility into priorities until you have checked the relevant available context, or clearly explain which required source is unavailable.",
  ];
}

function providerCapabilities(): string {
  return "You may also use your normal OpenCode workspace capabilities when they are relevant.";
}

function runInstruction(runId?: string | null): string {
  return runId
    ? `The current Workshop trace is ${runId}. If the user refers to this trace, this run, the current screen, or the selected span, use the local Workshop MCP server to inspect that Workshop context; the MCP tool schemas and descriptions are the source of truth for tool names and arguments.`
    : "No Workshop trace is currently selected. If the user asks about the current trace or screen, use the local Workshop MCP server to resolve whether Workshop has a focused run.";
}

/**
 * Build the env passed to the local OpenCode child process.
 *
 * The signature is kept (with an ignored argument) so existing call sites do
 * not need to change in lockstep.
 */
export function chatChildEnv(_queryApiKeyToken?: string | null): NodeJS.ProcessEnv {
  return { ...process.env };
}

export function resolveWorkshopMcpCommand(): { command: string; args: string[] } {
  const isCompiled = path
    .basename(process.execPath)
    .toLowerCase()
    .startsWith("raindrop");

  if (isCompiled) {
    return { command: process.execPath, args: ["workshop", "mcp"] };
  }

  return {
    command: process.execPath,
    args: [path.join(path.dirname(__filename), "index.ts"), "workshop", "mcp"],
  };
}

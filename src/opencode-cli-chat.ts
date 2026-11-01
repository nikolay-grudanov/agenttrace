import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type {
  AgentCliChatHandlers,
  AgentCliChatInput,
  AgentCliChatResult,
  AgentStreamEvent,
} from "./agent-chat";

/**
 * OpenCode CLI bridge for the Workshop sidepanel chat.
 *
 * `POST /api/agent/messages` spawns `opencode run --format json` in the active
 * workspace and maps the emitted JSONL events onto `AgentStreamEvent`s, which
 * the daemon broadcasts to the UI as `agent_message_stream` WS messages.
 *
 * Event grammar (opencode 1.18, `--format json`): one JSON object per stdout
 * line, `{ type, timestamp, sessionID, part }`. `part.type` distinguishes
 * `step-start`, `text`, `tool`, `reasoning`, and `step-finish` parts. Plugins
 * may print plain log lines to stdout; non-JSON lines are skipped.
 */

interface OpencodeToolState {
  status?: string;
  input?: unknown;
  output?: unknown;
}

interface OpencodePart {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: OpencodeToolState;
  tokens?: { input?: number; output?: number } | null;
  cost?: number;
}

interface OpencodeStreamEvent {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: OpencodePart;
  error?: { name?: string; data?: { message?: string; ref?: string } };
}

export function parseOpencodeJsonLine(line: string): OpencodeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as OpencodeStreamEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function preview(value: unknown, max = 200): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return undefined;
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export interface OpencodeMapperState {
  sessionReported: boolean;
  textBuffer: string;
  toolCalls: Map<string, boolean>;
}

/**
 * Map one raw opencode event to zero or more `AgentStreamEvent`s. Pure with
 * respect to the passed state object (mutated in place) so it is unit-testable
 * without spawning the CLI.
 */
export function mapOpencodeEvent(
  raw: OpencodeStreamEvent,
  state: OpencodeMapperState,
): AgentStreamEvent[] {
  const out: AgentStreamEvent[] = [];

  if (!state.sessionReported && typeof raw.sessionID === "string" && raw.sessionID) {
    state.sessionReported = true;
    out.push({ type: "provider_session", sessionId: raw.sessionID });
  }

  if (raw.type === "error") {
    const data = raw.error?.data;
    const content = [
      data?.message ?? raw.error?.name ?? "OpenCode reported an unknown error.",
      data?.ref ? `(ref ${data.ref})` : "",
    ].filter(Boolean).join(" ");
    out.push({ type: "error", content });
    return out;
  }

  const part = raw.part;
  if (!part || typeof part.type !== "string") return out;

  if (part.type === "text" && typeof part.text === "string") {
    state.textBuffer += part.text;
    out.push({ type: "text", content: state.textBuffer });
    return out;
  }

  if (part.type === "reasoning" && typeof part.text === "string" && part.text) {
    out.push({ type: "thinking_delta", content: part.text });
    return out;
  }

  if (part.type === "tool") {
    const id = typeof part.callID === "string" && part.callID ? part.callID : `tool-${out.length}-${raw.timestamp ?? 0}`;
    if (!state.toolCalls.has(id)) {
      state.toolCalls.set(id, false);
      out.push({
        type: "tool_start",
        id,
        name: typeof part.tool === "string" ? part.tool : "tool",
        input_preview: preview(part.state?.input),
      });
    }
    const status = part.state?.status;
    if ((status === "completed" || status === "error") && !state.toolCalls.get(id)) {
      state.toolCalls.set(id, true);
      out.push({
        type: "tool_finish",
        id,
        ok: status !== "error",
        output_preview: preview(part.state?.output),
      });
    }
    return out;
  }

  if (part.type === "step-finish") {
    out.push({
      type: "usage",
      input_tokens: part.tokens?.input,
      output_tokens: part.tokens?.output,
      cost_usd: typeof part.cost === "number" ? part.cost : undefined,
    });
  }

  return out;
}

/**
 * opencode `run` has no system-prompt flag, so sidepanel context rides along
 * with the first user message of a fresh session only; continued sessions
 * already carry it in their transcript.
 */
export function buildOpencodeUserContent(input: AgentCliChatInput): string {
  if (input.resumeSessionId) return input.content;
  const trace = input.runId ? ` The user is currently viewing Workshop trace ${input.runId}.` : "";
  return `${input.content}\n\n[You are the assistant in the Raindrop Workshop sidepanel (local trace debugger for AI agents).${trace} Use your normal workspace tools when relevant, and reply in the user's language.]`;
}

export function buildOpencodeArgs(input: AgentCliChatInput): string[] {
  const args = ["run", "--format", "json"];
  // Pin the built-in agent: a project's `default_agent` may reference an agent
  // that no longer exists, which fails every run in that workspace.
  args.push("--agent", process.env.AGENTTRACE_WORKSHOP_OPENCODE_AGENT ?? "build");
  if (input.resumeSessionId) {
    args.push("--session", input.resumeSessionId);
  } else {
    args.push("--title", "Raindrop Workshop");
  }
  args.push(buildOpencodeUserContent(input));
  return args;
}

/**
 * Workshop sidepanel sentinel env vars. When the plugin sees
 * `AGENTTRACE_SIDEPANEL_ACTIVE=1`, it registers the `workshop` stdio MCP server
 * via its `config` hook and prepends a sidepanel system prompt via
 * `experimental.chat.system.transform`. Without these the agent has no MCP
 * tools for `get_current_run` / `query_traces` / `get_span_payload` and no
 * awareness of the focused run — see F-006 in the plugin's PLAN.md.
 */
export function opencodeChildEnv(
  cwd: string,
  backendUrl: string,
  opts: { runId?: string | null; sessionId?: string | null; sidepanelConfigDir?: string | null } = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // opencode reads $PWD before falling back to getcwd() when picking the
    // project root, so spawn({ cwd }) alone would leak the daemon's workspace.
    PWD: cwd,
    // Let the opencode-workshop plugin stream each sidepanel turn into the
    // local Workshop daemon as an inspectable run.
    AGENTTRACE_LOCAL_WORKSHOP_URL: backendUrl,
    // Sidepanel bootstrap (F-006): gate the plugin's MCP + system-prompt
    // hook injections on this flag, and pass the focused run_id so the
    // injected system prompt can reference it.
    AGENTTRACE_SIDEPANEL_ACTIVE: "1",
    AGENTTRACE_SIDEPANEL_RUN_ID: opts.runId ?? "",
    // The plugin writes a per-run OPENCODE_CONFIG_DIR to expose its MCP
    // registration (it can only mutate its own process.env, not the env the
    // child opencode run will execve with). Re-export the path here so the
    // child picks up the same config the plugin produced.
    OPENCODE_CONFIG_DIR: opts.sidepanelConfigDir ?? "",
    // Provider attribution so the workshop mcp stdio server knows which agent
    // produced annotations / traces.
    AGENTTRACE_WORKSHOP_AGENT_PROVIDER: "opencode",
    AGENTTRACE_WORKSHOP_ANNOTATION_SOURCE: "opencode",
  };
}

/**
 * Detect whether the opencode-workshop-plugin is installed in any of the
 * locations opencode would consult (`<cwd>/.opencode/opencode.json` and the
 * user-global config). The plugin must be installed for the sidepanel chat
 * to receive its MCP tools and system-prompt injection — without it the
 * agent runs as a generic project assistant with no trace context.
 */
export function isWorkshopPluginInstalled(cwd: string): boolean {
  // Read HOME at call time (not module load) so tests can monkey-patch
  // process.env.HOME to isolate the global-config scan.
  const home = process.env.HOME ?? os.homedir();
  const candidates = [
    path.join(cwd, ".opencode", "opencode.json"),
    path.join(cwd, ".opencode", "opencode.jsonc"),
    path.join(home, ".config", "opencode", "opencode.json"),
    path.join(home, ".config", "opencode", "opencode.jsonc"),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const json = JSON.parse(text) as { plugin?: unknown };
      const pluginField = json.plugin;
      if (Array.isArray(pluginField)) {
        if (pluginField.some((p) => typeof p === "string" && p.includes("opencode-workshop-plugin"))) return true;
      } else if (typeof pluginField === "string" && pluginField.includes("opencode-workshop-plugin")) {
        return true;
      }
    } catch {
      // file missing or not JSON; skip
    }
  }
  return false;
}

/**
 * F-006 sidepanel bootstrap: write a per-spawn OPENCODE_CONFIG_DIR containing
 * opencode.json that registers the `workshop` stdio MCP server. The plugin
 * does the same in the parent process, but `opencode run` execve's its own
 * child process which does not see `process.env` mutations made by the
 * plugin in the parent. Exposing OPENCODE_CONFIG_DIR via the spawn env is the
 * only way to wire MCP into the child without `--mcp-config` (which `opencode
 * run` does not support).
 *
 * Returns the directory path, or `null` if the write fails. The caller passes
 * the path through `OPENCODE_CONFIG_DIR` in the child env. Best-effort: any
 * failure is silently swallowed and the agent just runs without MCP tools.
 */
export function writeSidepanelConfigDir(input: AgentCliChatInput): string | null {
  if (!isWorkshopPluginInstalled(input.cwd)) return null;
  try {
    const cacheRoot = path.join(os.homedir(), ".cache", "workshop-sidepanel");
    fs.mkdirSync(cacheRoot, { recursive: true });
    // Sweep stale entries older than 1 hour.
    try {
      const now = Date.now();
      for (const entry of fs.readdirSync(cacheRoot)) {
        try {
          const st = fs.statSync(path.join(cacheRoot, entry));
          if (now - st.mtimeMs > 60 * 60 * 1000) {
            fs.rmSync(path.join(cacheRoot, entry), { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
    const dir = path.join(cacheRoot, `${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const command = [process.execPath, path.join(import.meta.dir, "index.ts"), "workshop", "mcp"];
    const url = (input.backendUrl ?? "http://localhost:5899").replace(/\/v1\/?$/, "");
    const config = {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        workshop: {
          type: "local" as const,
          command,
          enabled: true,
          environment: {
            AGENTTRACE_WORKSHOP_URL: url,
            AGENTTRACE_WORKSHOP_AGENT_PROVIDER: "opencode",
            AGENTTRACE_WORKSHOP_ANNOTATION_SOURCE: "opencode",
          },
        },
      },
    };
    fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
    return dir;
  } catch {
    return null;
  }
}

export function runOpencodeCliChat(
  input: AgentCliChatInput,
  handlers: AgentCliChatHandlers,
): Promise<AgentCliChatResult> {
  const bin = process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN ?? "opencode";
  if (!isWorkshopPluginInstalled(input.cwd)) {
    const message =
      "Workshop sidepanel requires the opencode-workshop-plugin to be installed in this project. " +
      "Run `bunx opencode-workshop-plugin install` in the project root, then retry.";
    handlers.onError?.(message);
    return Promise.resolve({ code: 1, signal: null, stderr: message });
  }
  // F-006: write a tiny opencode.json in a tmp dir so the opencode child
  // process (spawned with `opencode run`) picks up the `workshop` MCP server
  // registration via OPENCODE_CONFIG_DIR. The plugin also writes its own copy
  // in the parent process; both produce the same content and only one ends up
  // being read. Without this, opencode run has no --mcp-config flag and the
  // agent has zero trace-context MCP tools.
  const sidepanelConfigDir = writeSidepanelConfigDir(input);
  const child = spawn(bin, buildOpencodeArgs(input), {
    cwd: input.cwd,
    env: opencodeChildEnv(input.cwd, input.backendUrl, {
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      sidepanelConfigDir,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (input.abortSignal) {
    if (input.abortSignal.aborted) child.kill("SIGINT");
    input.abortSignal.addEventListener("abort", () => child.kill("SIGINT"), { once: true });
  }

  const state: OpencodeMapperState = { sessionReported: false, textBuffer: "", toolCalls: new Map() };
  const emit = (event: AgentStreamEvent) => {
    if (event.type === "text") {
      handlers.onText(event.content);
      return;
    }
    if (event.type === "provider_session") {
      handlers.onProviderSession(event.sessionId);
      return;
    }
    handlers.onEvent?.(event);
  };

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf("\n");
      const raw = parseOpencodeJsonLine(line);
      if (!raw) continue;
      for (const event of mapOpencodeEvent(raw, state)) emit(event);
    }
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  return new Promise<AgentCliChatResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

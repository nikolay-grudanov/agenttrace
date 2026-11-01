/**
 * Tests for src/opencode-cli-chat.ts — the OpenCode CLI bridge behind
 * POST /api/agent/messages.
 *
 * Pins the `opencode run --format json` event grammar (opencode 1.18):
 *   - stdout lines that are not JSON (plugin logs) are skipped
 *   - the first sessionID becomes a single provider_session event
 *   - text parts accumulate into one growing text buffer
 *   - a completed tool part yields tool_start + tool_finish
 *   - reasoning parts become thinking_delta
 *   - step-finish becomes usage (tokens + cost)
 *   - sidepanel context is appended only to fresh sessions
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildOpencodeArgs,
  buildOpencodeUserContent,
  isWorkshopPluginInstalled,
  mapOpencodeEvent,
  opencodeChildEnv,
  parseOpencodeJsonLine,
  runOpencodeCliChat,
  writeSidepanelConfigDir,
  type OpencodeMapperState,
} from "../src/opencode-cli-chat";
import type { AgentCliChatInput } from "../src/agent-chat";

function freshState(): OpencodeMapperState {
  return { sessionReported: false, textBuffer: "", toolCalls: new Map() };
}

function input(partial: Partial<AgentCliChatInput> = {}): AgentCliChatInput {
  return {
    backendUrl: "http://localhost:5899",
    content: "hello",
    cwd: "/tmp/demo",
    runId: null,
    sessionId: null,
    userMessageId: null,
    resumeSessionId: null,
    ...partial,
  };
}

describe("parseOpencodeJsonLine", () => {
  test("parses a well-formed event line", () => {
    const parsed = parseOpencodeJsonLine('{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"hi"}}');
    expect(parsed?.type).toBe("text");
    expect(parsed?.sessionID).toBe("ses_1");
  });

  test("skips plugin log lines and blank lines", () => {
    expect(parseOpencodeJsonLine("[kolya-oswp] [info] loading plugin")).toBeNull();
    expect(parseOpencodeJsonLine("")).toBeNull();
  });

  test("skips malformed JSON", () => {
    expect(parseOpencodeJsonLine('{"type":"text" oops')).toBeNull();
  });
});

describe("mapOpencodeEvent", () => {
  test("first sessionID emits exactly one provider_session", () => {
    const state = freshState();
    const first = mapOpencodeEvent({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }, state);
    const second = mapOpencodeEvent({ type: "text", sessionID: "ses_1", part: { type: "step-start" } }, state);
    expect(first).toEqual([{ type: "provider_session", sessionId: "ses_1" }]);
    expect(second).toEqual([]);
  });

  test("text parts accumulate into the full buffer", () => {
    const state = freshState();
    const a = mapOpencodeEvent({ sessionID: "s", part: { type: "text", text: "Hel" } }, state);
    const b = mapOpencodeEvent({ sessionID: "s", part: { type: "text", text: "lo" } }, state);
    expect(a).toEqual([
      { type: "provider_session", sessionId: "s" },
      { type: "text", content: "Hel" },
    ]);
    expect(b).toEqual([{ type: "text", content: "Hello" }]);
  });

  test("completed tool part yields tool_start then tool_finish", () => {
    const state = freshState();
    const events = mapOpencodeEvent({
      type: "tool_use",
      sessionID: "s",
      part: {
        type: "tool",
        tool: "read",
        callID: "call_1",
        state: { status: "completed", input: { filePath: "/tmp/x" }, output: "contents" },
      },
    }, state);
    expect(events).toEqual([
      { type: "provider_session", sessionId: "s" },
      { type: "tool_start", id: "call_1", name: "read", input_preview: '{"filePath":"/tmp/x"}' },
      { type: "tool_finish", id: "call_1", ok: true, output_preview: "contents" },
    ]);
    // A later duplicate part with the same callID does not re-emit anything.
    expect(mapOpencodeEvent({
      part: { type: "tool", tool: "read", callID: "call_1", state: { status: "completed" } },
    }, state)).toEqual([]);
  });

  test("error tool status maps to tool_finish with ok=false", () => {
    const state = freshState();
    const events = mapOpencodeEvent({
      part: { type: "tool", tool: "bash", callID: "call_2", state: { status: "error", output: "boom" } },
    }, state);
    expect(events[1]).toEqual({ type: "tool_finish", id: "call_2", ok: false, output_preview: "boom" });
  });

  test("running tool status emits only tool_start", () => {
    const state = freshState();
    const events = mapOpencodeEvent({
      part: { type: "tool", tool: "bash", callID: "call_3", state: { status: "running" } },
    }, state);
    expect(events).toEqual([{ type: "tool_start", id: "call_3", name: "bash", input_preview: undefined }]);
  });

  test("reasoning part becomes thinking_delta", () => {
    const state = freshState();
    expect(mapOpencodeEvent({ part: { type: "reasoning", text: "hmm" } }, state))
      .toEqual([{ type: "thinking_delta", content: "hmm" }]);
  });

  test("step-finish becomes usage with tokens and cost", () => {
    const state = freshState();
    expect(mapOpencodeEvent({
      type: "step_finish",
      part: { type: "step-finish", reason: "stop", tokens: { input: 10, output: 5 }, cost: 0.01 },
    }, state)).toEqual([{ type: "usage", input_tokens: 10, output_tokens: 5, cost_usd: 0.01 }]);
  });

  test("top-level error event surfaces its message and ref", () => {
    const state = freshState();
    expect(mapOpencodeEvent({
      type: "error",
      sessionID: "s",
      error: { name: "UnknownError", data: { message: "Unexpected server error.", ref: "err_42" } },
    }, state)).toEqual([
      { type: "provider_session", sessionId: "s" },
      { type: "error", content: "Unexpected server error. (ref err_42)" },
    ]);
  });
});

describe("buildOpencodeUserContent / buildOpencodeArgs", () => {
  test("fresh session carries sidepanel context and run id", () => {
    const content = buildOpencodeUserContent(input({ content: "what broke?", runId: "run_abc" }));
    expect(content).toContain("what broke?");
    expect(content).toContain("Raindrop Workshop sidepanel");
    expect(content).toContain("run_abc");
  });

  test("continued session passes the content through untouched", () => {
    const content = buildOpencodeUserContent(input({ content: "and now?", resumeSessionId: "ses_1" }));
    expect(content).toBe("and now?");
  });

  test("args: pinned agent, fresh session gets a title, resumed gets --session", () => {
    expect(buildOpencodeArgs(input())).toEqual([
      "run", "--format", "json", "--agent", "build", "--title", "Raindrop Workshop",
      expect.stringContaining("hello"),
    ]);
    expect(buildOpencodeArgs(input({ resumeSessionId: "ses_9" }))).toEqual([
      "run", "--format", "json", "--agent", "build", "--session", "ses_9", "hello",
    ]);
  });
});

describe("opencodeChildEnv", () => {
  test("forces PWD to the chat cwd and points the plugin at the daemon", () => {
    const env = opencodeChildEnv("/tmp/demo", "http://localhost:5899");
    expect(env.PWD).toBe("/tmp/demo");
    expect(env.AGENTTRACE_LOCAL_WORKSHOP_URL).toBe("http://localhost:5899");
  });

  test("sidepanel mode is on by default with optional run_id", () => {
    const env = opencodeChildEnv("/tmp/demo", "http://localhost:5899", { runId: "run_abc" });
    expect(env.AGENTTRACE_SIDEPANEL_ACTIVE).toBe("1");
    expect(env.AGENTTRACE_SIDEPANEL_RUN_ID).toBe("run_abc");
    expect(env.AGENTTRACE_WORKSHOP_AGENT_PROVIDER).toBe("opencode");
    expect(env.AGENTTRACE_WORKSHOP_ANNOTATION_SOURCE).toBe("opencode");
  });

  test("sidepanel run_id is empty string when not provided", () => {
    const env = opencodeChildEnv("/tmp/demo", "http://localhost:5899");
    expect(env.AGENTTRACE_SIDEPANEL_RUN_ID).toBe("");
  });
});

describe("isWorkshopPluginInstalled", () => {
  // Isolate from real $HOME so the developer's ~/.config/opencode/opencode.json
  // (which lists the plugin globally) does not affect these cases.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oswp-test-"));
  const fakeHome = path.join(tmp, "home");
  const savedHome = process.env.HOME;

  beforeEach(() => {
    fs.mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  test("returns false when no opencode.json exists", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "no-plugin-"));
    expect(isWorkshopPluginInstalled(cwd)).toBe(false);
  });

  test("returns true when project opencode.json lists the plugin", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "with-plugin-"));
    fs.mkdirSync(path.join(cwd, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".opencode", "opencode.json"), JSON.stringify({
      plugin: ["@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.15"],
    }));
    expect(isWorkshopPluginInstalled(cwd)).toBe(true);
  });

  test("returns false when only a non-workshop plugin is configured", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "missing-"));
    fs.mkdirSync(path.join(cwd, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".opencode", "opencode.json"), JSON.stringify({
      plugin: ["some-other-plugin@1.0.0"],
    }));
    expect(isWorkshopPluginInstalled(cwd)).toBe(false);
  });

  test("returns true when user-global opencode.json lists the plugin as a string", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "cwd-"));
    const ocDir = path.join(fakeHome, ".config", "opencode");
    fs.mkdirSync(ocDir, { recursive: true });
    fs.writeFileSync(path.join(ocDir, "opencode.json"), JSON.stringify({
      plugin: "@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.15",
    }));
    expect(isWorkshopPluginInstalled(cwd)).toBe(true);
  });
});

describe("runOpencodeCliChat (F-006 sidepanel bootstrap)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oswp-bridge-"));
  const savedBin = process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN;
  const savedHome = process.env.HOME;
  const fakeHome = path.join(tmp, "home");

  beforeEach(() => {
    fs.mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedBin === undefined) delete process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN;
    else process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN = savedBin;
  });

  test("returns 1 + friendly error when plugin is not installed", async () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "no-plugin-"));
    let captured: string | null = null;
    const result = await runOpencodeCliChat(input({ cwd }), {
      onText: () => {},
      onStatus: () => {},
      onProviderSession: () => {},
      onError: (content) => { captured = content; },
    });
    expect(result.code).toBe(1);
    expect(captured).toContain("opencode-workshop-plugin");
  });

  test("crosses the plugin gate and fails with ENOENT when plugin is installed", async () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "with-plugin-"));
    fs.mkdirSync(path.join(cwd, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".opencode", "opencode.json"), JSON.stringify({
      plugin: ["@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.15"],
    }));
    // Force spawn to fail fast with ENOENT by pointing the bridge at a
    // non-existent binary. This proves we passed the plugin-detection gate.
    process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN = "/nonexistent-oswp-test-bin";
    let rejected = false;
    try {
      await runOpencodeCliChat(input({ cwd }), {
        onText: () => {},
        onStatus: () => {},
        onProviderSession: () => {},
        onError: () => {},
      });
    } catch (err) {
      rejected = true;
      expect((err as Error).message.toLowerCase()).toMatch(/enoent|not.found/);
    } finally {
      if (savedBin === undefined) delete process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN;
      else process.env.AGENTTRACE_WORKSHOP_OPENCODE_BIN = savedBin;
    }
    expect(rejected).toBe(true);
  });
});

describe("writeSidepanelConfigDir (F-006)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oswp-sidepanel-"));
  const savedHome = process.env.HOME;
  const fakeHome = path.join(tmp, "home");

  beforeEach(() => {
    fs.mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  test("returns null when plugin is not installed", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "no-plugin-"));
    expect(writeSidepanelConfigDir(input({ cwd }))).toBeNull();
  });

  test("writes opencode.json with workshop MCP registration", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "with-plugin-"));
    fs.mkdirSync(path.join(cwd, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".opencode", "opencode.json"), JSON.stringify({
      plugin: ["@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.15"],
    }));
    const dir = writeSidepanelConfigDir(input({ cwd, backendUrl: "http://localhost:5899" }));
    expect(dir).not.toBeNull();
    expect(fs.existsSync(path.join(dir!, "opencode.json"))).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(dir!, "opencode.json"), "utf8"));
    expect(written.mcp.workshop.type).toBe("local");
    expect(Array.isArray(written.mcp.workshop.command)).toBe(true);
    // workshop MCP must point at our stdio server.
    expect(written.mcp.workshop.command.join(" ")).toContain("workshop mcp");
    expect(written.mcp.workshop.environment.AGENTTRACE_WORKSHOP_URL).toBe("http://localhost:5899");
    expect(written.mcp.workshop.environment.AGENTTRACE_WORKSHOP_AGENT_PROVIDER).toBe("opencode");
  });

  test("strips /v1/ suffix from AGENTTRACE_WORKSHOP_URL", () => {
    const cwd = fs.mkdtempSync(path.join(tmp, "strip-v1-"));
    fs.mkdirSync(path.join(cwd, ".opencode"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".opencode", "opencode.json"), JSON.stringify({
      plugin: ["@grudanov-nikolay/opencode-workshop-plugin@0.1.0-kolya.15"],
    }));
    const dir = writeSidepanelConfigDir(input({ cwd, backendUrl: "http://localhost:5899/v1/" }));
    const written = JSON.parse(fs.readFileSync(path.join(dir!, "opencode.json"), "utf8"));
    expect(written.mcp.workshop.environment.AGENTTRACE_WORKSHOP_URL).toBe("http://localhost:5899");
  });
});

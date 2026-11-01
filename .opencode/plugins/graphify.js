// graphify OpenCode plugin
// Injects a knowledge graph reminder before bash tool calls when the graph exists.
//
// IMPORTANT: keep the reminder string free of backticks and $(...) constructs.
// The hook prepends `echo "<reminder>" && <cmd>` to the user's bash command;
// backticks inside the double-quoted echo trigger bash command substitution,
// which both corrupts tool output and silently executes the very graphify
// command we are only suggesting. Plain words render fine in opencode's TUI.
//
// F-041 — migrated to the OpenCode v2 plugin API. The v1 contract
// (`export const GraphifyPlugin = async ({ directory }) => ({ "tool.execute.before": ... })`)
// is rejected by the v2 loader:
//
//   PluginModule.LoadError: Plugin must export a default definition with an
//   id and an effect or setup function.
//
// v2 ignores named exports entirely and delivers a single argument to tool
// hooks, so the whole shape changed:
//   v1  input.tool / output.args.command
//   v2  e.tool      / e.input.command
// `e.input` is mutable; `e.tool` and `e.sessionID` are read-only.
//
// Two v2-specific gotchas, both verified against OpenCode v2.0.32 on
// 2026-10-21 (probe plugin writing to a file, because the v2 binary swallows
// console.log from plugins):
//
//  1. The tool is named **`shell`**, not `bash`. The v1 hook filtered on
//     `input.tool === "bash"` and therefore matched nothing under v2 — the
//     hook fired, but every call was ignored. Accept both names so the same
//     file works on v1 and v2.
//
//  2. Replacing the whole `e.input` object (`e.input = { ...args, command }`)
//     is the pattern the v2 binary's own built-in plugin uses, and it is what
//     actually reaches the executed command. Mutating `e.input.command` in
//     place did not.
//
// Verified end-to-end: the captured bash span shows
// `echo "<marker>" && <original command>`.
import { existsSync } from "fs";
import { join } from "path";

const PLUGIN_ID = "graphify";

const REMINDER =
  'echo "[graphify] knowledge graph at graphify-out/. For focused questions, run graphify query with your question (scoped subgraph, usually much smaller than GRAPH_REPORT.md) instead of grepping raw files. Read GRAPH_REPORT.md only for broad architecture context." && ';

// v1 calls the shell tool "bash"; v2 calls it "shell".
const isShellTool = (tool) => tool === "bash" || tool === "shell";

// v1 plugin factory — kept so the plugin still loads on OpenCode < 2.0.
export const GraphifyPlugin = async ({ directory }) => {
  let reminded = false;

  return {
    "tool.execute.before": async (input, output) => {
      if (reminded) return;
      if (!existsSync(join(directory, "graphify-out", "graph.json"))) return;

      if (isShellTool(input.tool)) {
        output.args.command = REMINDER + output.args.command;
        reminded = true;
      }
    },
  };
};

// v2 plugin setup — `ctx` has no `directory`/`worktree`; the project directory
// lives at `ctx.location.directory`.
const setup = async (ctx) => {
  const location = (ctx && ctx.location) || {};
  const directory =
    typeof location.directory === "string" && location.directory.length > 0
      ? location.directory
      : process.cwd();

  if (!ctx.tool || typeof ctx.tool.hook !== "function") {
    console.log(
      "[graphify] [warn] OpenCode v2: ctx.tool.hook unavailable — reminder not injected",
    );
    return;
  }

  if (!existsSync(join(directory, "graphify-out", "graph.json"))) {
    console.log(
      `[graphify] no knowledge graph at ${join(directory, "graphify-out", "graph.json")} — reminder disabled`,
    );
    return;
  }

  let reminded = false;

  await ctx.tool.hook("execute.before", async (e) => {
    if (reminded) return;
    if (!e || !isShellTool(e.tool)) return;
    const args = e.input;
    if (!args || typeof args.command !== "string" || args.command.length === 0) return;

    // Replace the whole input object — that is what reaches the command.
    e.input = { ...args, command: REMINDER + args.command };
    reminded = true;
  });
};

// KOLYA PATCH (F-041): dual-version default export.
//   - OpenCode >= 2.0 reads `id` + `setup(ctx)` (the v2 contract).
//   - OpenCode <  2.0 calls `server()` and consumes the legacy hooks object.
export default {
  id: PLUGIN_ID,
  setup,
  server: GraphifyPlugin,
};

<p align="center">
  <img src="./docs/assets/workshop-hero.png" alt="agenttrace: the local debugger your agent is missing." width="100%">
</p>

# agenttrace (Kolya fork, formerly `opencode-workshop`)

**The local debugger your agent is missing.** Watch your agent think locally,
the moment it happens: every token, every tool call, every decision.

Give Claude Code the power to read your traces, write evals against your
codebase, and fix what's broken.

This is Nikolai Grudanov's fork of [@raindrop-ai/workshop](https://github.com/raindrop-ai/workshop)
(distributed here as `@grudanov-nikolay/agenttrace`, npm package renamed from
`@grudanov-nikolay/opencode-workshop@0.0.1` → `@grudanov-nikolay/agenttrace@0.1.0`
on 2026-09-17). It ships the same daemon plus 14 additional features on top of
upstream. See [Differences from upstream](#differences-from-upstream) below.

> **Alpha notice:** `0.1.0` is the first public alpha under the new name.
> The previous `0.0.1` was published as `@grudanov-nikolay/opencode-workshop`.
> File issues at <https://github.com/nikolay-grudanov/agenttrace/issues>.

## Install

Pick **one** of the two methods below — they install the same daemon.

### Option A — npm (Linux x64, Windows x64)

```bash
npm install -g @grudanov-nikolay/agenttrace
raindrop workshop serve
```

No build tools required at runtime: the npm tarball contains pre-compiled
Bun binaries (`binaries/raindrop-linux-x64`, `binaries/raindrop-windows-x64.exe`),
and a tiny Node launcher (`bin/raindrop.js`) selects the right one for your
platform.

### Option B — upstream curl installer

If you prefer the upstream binary path (works on macOS too):

```bash
curl -fsSL https://raindrop.sh/install | bash
```

This installs the upstream `raindrop` CLI; you lose the 14 fork features
listed below but gain macOS support.

### Option C — build from source (developers only)

Use this if you want to hack on Workshop itself or run on an unsupported
platform.

```bash
git clone https://github.com/nikolay-grudanov/agenttrace.git
cd agenttrace
bun install
bun run dev    # starts daemon on :5899 + Vite UI on :5900
```

Requires [Bun](https://bun.sh) ≥ 1.3.13.

## Instrument your agent

Open your coding agent of choice in your repository and run:

```text
/instrument-agent
```

This will instrument your agent with Raindrop tracing and open Workshop in your browser.

If you're using OpenCode, install
[`@grudanov-nikolay/agenttrace-opencode-plugin`](https://www.npmjs.com/package/@grudanov-nikolay/agenttrace-opencode-plugin)
(separate package) and add it to your OpenCode config.

## What it does

- **Live streamed traces.** Every token, tool call, and span streams into
  Workshop as it happens. No polling, no refreshing.
- **Coding-agent integration.** Claude Code reads your traces, writes evals
  against your codebase, and fixes what's broken.
- **Self-healing eval loop.** Claude writes the eval, runs your agent, sees the
  failure, fixes the code, and re-runs until every assertion passes.
- **Local replay.** `/setup-agent-replay` scaffolds an HTTP endpoint that replays a
  production trace against your real agent code.

## Compatible with everything

- **Languages:** TypeScript, Python, Go, Rust
- **SDKs:** Vercel AI SDK, OpenAI Agents SDK, Anthropic SDK, Claude Agent SDK,
  LangChain, LangGraph, CrewAI, Mastra, Pydantic AI, DSPy, Google ADK, Strands,
  Agno, Deep Agents
- **Providers:** AWS Bedrock, Azure OpenAI, Vertex AI
- **Coding agents:** Claude Code, Codex, Devin, Cursor, OpenCode

## Differences from upstream

This fork adds the following on top of `@raindrop-ai/workshop@0.0.17`:

| | Feature | Where |
|---|---|---|
| F-006 | Sidepanel prompt chips (data-driven from sidepanel.json) | app/src |
| F-008 | Full-text search UI + FTS5 storage layer for spans | src/db, app/src |
| F-012 | Ruled-table stats panels under the header row | app/src |
| F-014 | Filters: agent / user / git-context, with facets on /api/search | src/api |
| F-015 | Data-driven sidepanel prompt chips with runtime override | app/src |
| F-016 | OpenCode plugin FTS integration (event-spans indexed, MATCH sanitized) | depends on plugin |
| F-017 | Local multi-filter search + sidebar cleanup | app/src |
| F-018 | Globe-only LangSwitcher + flyout locale menu | app/src |
| F-019 | Filter-only search (empty q now applies filters instead of returning 0) | src/api |
| F-020 | Dedicated `compression` span type for OpenCode DCP | src/db |
| F-021 | DCP compression analytics: convo stats + feed + summaries | src/db, app/src |

Upstream is reachable at <https://github.com/raindrop-ai/workshop>. This fork
is rebased against upstream `main` periodically; expect 3–5 fork-specific
commits ahead of origin at any time.

## Configuration

| Env var | Purpose | Default |
| --- | --- | --- |
| `RAINDROP_WORKSHOP_PORT` | HTTP + WS port | `5899` |
| `RAINDROP_WORKSHOP_DB_PATH` | SQLite database file | `~/.raindrop/raindrop_workshop.db` |
| `RAINDROP_LOCAL_DEBUGGER` | SDK-side: where to mirror traces | unset |

## CLI

```bash
raindrop workshop          # start and open UI
raindrop workshop setup    # write .env, then start and open
raindrop workshop status   # check health
raindrop workshop reset    # delete local DB after confirmation
```

`raindrop update` is not available via the npm-install path because the npm
package always carries the latest pre-compiled binary. To update, run
`npm update -g @grudanov-nikolay/agenttrace`.

## License

MIT. Dual copyright: (c) 2026 Invisible Tools, Inc. (dba Raindrop) for the
upstream-derived code, (c) 2026 Nikolai Grudanov for the modifications.
See [LICENSE](./LICENSE).


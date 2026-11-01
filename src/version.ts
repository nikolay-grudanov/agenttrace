// Inlined at compile time via `bun build --define __AGENTTRACE_VERSION__=...`
// (see scripts/build-bun.ts). Source-mode runs fall back to "0.0.0-dev".
declare const __AGENTTRACE_VERSION__: string | undefined;

export const VERSION: string =
  typeof __AGENTTRACE_VERSION__ === "string" && __AGENTTRACE_VERSION__.length > 0
    ? __AGENTTRACE_VERSION__
    : "0.0.0-dev";

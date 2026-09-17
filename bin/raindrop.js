#!/usr/bin/env node
/**
 * raindrop CLI launcher — npm-distributed entry point for Kolya's fork of
 * @raindrop/workshop (now: @grudanov-nikolay/agenttrace). Detects the user's
 * platform/arch and spawns the matching pre-compiled Bun binary from
 * binaries/. No runtime dependency on Bun.
 *
 * Supported: linux-x64, win32-x64. Other platforms print a clear error pointing
 * the user to the GitHub repo where they can build from source.
 *
 * Usage is identical to the binary itself: `raindrop <command> [args...]`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BINARIES_DIR = path.join(__dirname, "..", "binaries");
const VERSION = require("../package.json").version;

const PLATFORM_MAP = {
  "linux-x64":  { file: "raindrop-linux-x64",         exec: true  },
  "win32-x64":  { file: "raindrop-windows-x64.exe",   exec: false },
};

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function resolveBinary() {
  const key = platformKey();
  const entry = PLATFORM_MAP[key];
  if (!entry) {
    return null;
  }
  const filePath = path.join(BINARIES_DIR, entry.file);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return { filePath, exec: entry.exec };
}

function printPlatformError() {
  const key = platformKey();
  const supported = Object.keys(PLATFORM_MAP).join(", ");
  process.stderr.write(
    [
      `raindrop ${VERSION}: your platform (${key}) is not in the pre-built binary set.`,
      `Supported pre-built platforms: ${supported}.`,
      "",
      "Two ways forward:",
      `  1. Open an issue at https://github.com/nikolay-grudanov/agenttrace/issues`,
      `     requesting a build for ${key}.`,
      `  2. Build from source: clone the repo, install Bun (https://bun.sh),`,
      `     then run 'bun install && bun run dev'.`,
      "",
    ].join("\n")
  );
}

function spawnBinary(bin) {
  // Pass through stdio so CLI output and exit codes match a direct invocation.
  // On Windows, .exe binaries can be spawned directly via Node's spawn() without
  // a shell. The Bun-compiled binary is self-contained and ignores argv[0].
  const child = spawn(bin.filePath, process.argv.slice(2), {
    stdio: "inherit",
    windowsHide: false,
    env: process.env,
  });
  child.on("error", (err) => {
    process.stderr.write(`raindrop: failed to spawn ${bin.filePath}: ${err.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

function main() {
  const bin = resolveBinary();
  if (!bin) {
    printPlatformError();
    process.exit(1);
  }
  spawnBinary(bin);
}

main();

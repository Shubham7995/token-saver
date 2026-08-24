#!/usr/bin/env node
/**
 * token-saver proxy launcher.
 *
 *   TOKEN_SAVER_SHADOW=1 npm run proxy     # measure only, change nothing
 *   npm run proxy                          # actually compress
 *
 * Environment:
 *   PORT                        listen port (default 8787)
 *   TOKEN_SAVER_SHADOW          "1" = measure what compression WOULD save and
 *                               forward the original body untouched
 *   TOKEN_SAVER_ENGINES         comma-separated engine ids (default "rtk")
 *   TOKEN_SAVER_MIN_CHARS       skip bodies smaller than this (default 2000)
 *   TOKEN_SAVER_LOG             append one JSON object per request to this file
 *   TOKEN_SAVER_ANTHROPIC_URL   upstream for /v1/messages
 *   TOKEN_SAVER_OPENAI_URL      upstream for /v1/responses and /v1/chat/completions
 */
import { appendFileSync } from "node:fs";
import { createProxyServer, type RequestReport } from "../src/proxy/server.ts";

const port = Number(process.env.PORT ?? 8787);
const shadow = process.env.TOKEN_SAVER_SHADOW === "1";
const engines = (process.env.TOKEN_SAVER_ENGINES ?? "rtk")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const minChars = Number(process.env.TOKEN_SAVER_MIN_CHARS ?? 2000);
const logFile = process.env.TOKEN_SAVER_LOG;

let requests = 0;
let measured = 0;
let originalTokens = 0;
let compressedTokens = 0;
let bestPercent = 0;
let worstPercent = 100;

function pct(part: number, whole: number): string {
  return whole > 0 ? ((part / whole) * 100).toFixed(1) + "%" : "0%";
}

const server = createProxyServer({
  engines,
  minChars,
  shadow,
  onRequest: (r: RequestReport) => {
    requests++;
    if (r.mode !== "passthrough") {
      measured++;
      originalTokens += r.originalTokens;
      compressedTokens += r.compressedTokens;
      bestPercent = Math.max(bestPercent, r.savingsPercent);
      worstPercent = Math.min(worstPercent, r.savingsPercent);
    }
    if (logFile) {
      try {
        appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...r }) + "\n");
      } catch {
        // logging must never take the proxy down
      }
    }

    const saved = originalTokens - compressedTokens;
    const detail =
      r.mode === "passthrough"
        ? (r.note ?? "passthrough")
        : `${r.originalTokens} -> ${r.compressedTokens} tok (${r.savingsPercent}%)` +
          (r.mode === "shadow" ? " [shadow]" : "");
    const running = measured > 0 ? `   [session ${saved} tok, ${pct(saved, originalTokens)}]` : "";
    console.log(`${r.method} ${r.path} -> ${r.status}  ${detail}${running}`);
  },
});

server.listen(port, "127.0.0.1", () => {
  console.log(`token-saver proxy on http://127.0.0.1:${port}`);
  if (shadow) {
    console.log("MODE: SHADOW — measuring only, requests are forwarded unchanged.");
  } else {
    console.log(`MODE: ACTIVE — bodies are rewritten. engines: ${engines.join(" -> ")}`);
  }
  console.log(`min body: ${minChars} chars${logFile ? `   log: ${logFile}` : ""}`);
  console.log("");
  console.log(`  Claude Code:  ANTHROPIC_BASE_URL=http://127.0.0.1:${port} claude`);
  console.log("  Codex:        set base_url in ~/.codex/config.toml (see README)");
  console.log(`  OpenAI SDK:   baseURL: 'http://127.0.0.1:${port}/v1'`);
  console.log("");
  console.log("Ctrl-C for the session report.");
});

function summary(): void {
  const saved = originalTokens - compressedTokens;
  console.log("\n──────── token-saver session report ────────");
  console.log(`mode                : ${shadow ? "shadow (nothing was changed)" : "active"}`);
  console.log(`requests seen       : ${requests}`);
  console.log(`compressible        : ${measured}  (${pct(measured, requests)} of requests)`);
  if (measured === 0) {
    console.log("\nNothing was compressible. Either traffic did not reach the proxy,");
    console.log("or every body was under the min-chars threshold.");
  } else {
    console.log(`tokens in           : ${originalTokens}`);
    console.log(`tokens out          : ${compressedTokens}`);
    console.log(`saved               : ${saved}  (${pct(saved, originalTokens)})`);
    console.log(`best / worst request: ${bestPercent}% / ${worstPercent}%`);
    console.log("");
    console.log("Note: this counts REQUEST tokens only, and ignores prompt-cache");
    console.log("economics — a cached prefix is billed at a fraction of these rates.");
    console.log("Treat it as an upper bound on what compression can win you.");
  }
  console.log("────────────────────────────────────────────");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    summary();
    server.close(() => process.exit(0));
  });
}

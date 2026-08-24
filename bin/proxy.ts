#!/usr/bin/env node
/**
 * token-saver proxy launcher.
 *
 *   PORT=8787 npm run proxy
 *
 * Environment:
 *   PORT                        listen port (default 8787)
 *   TOKEN_SAVER_ENGINES         comma-separated engine ids (default "rtk")
 *   TOKEN_SAVER_MIN_CHARS       skip bodies smaller than this (default 2000)
 *   TOKEN_SAVER_ANTHROPIC_URL   upstream for /v1/messages
 *   TOKEN_SAVER_OPENAI_URL      upstream for /v1/responses and /v1/chat/completions
 */
import { createProxyServer } from "../src/proxy/server.ts";

const port = Number(process.env.PORT ?? 8787);
const engines = (process.env.TOKEN_SAVER_ENGINES ?? "rtk")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const minChars = Number(process.env.TOKEN_SAVER_MIN_CHARS ?? 2000);

let totalOriginal = 0;
let totalCompressed = 0;

const server = createProxyServer({
  engines,
  minChars,
  onRequest: (line) => {
    const match = line.match(/(\d+) -> (\d+) tok/);
    if (match) {
      totalOriginal += Number(match[1]);
      totalCompressed += Number(match[2]);
      const saved = totalOriginal - totalCompressed;
      const pct = ((saved / totalOriginal) * 100).toFixed(1);
      console.log(`${line}   [session: ${saved} tokens saved, ${pct}%]`);
    } else {
      console.log(line);
    }
  },
});

server.listen(port, "127.0.0.1", () => {
  console.log(`token-saver proxy on http://127.0.0.1:${port}`);
  console.log(`engines: ${engines.join(" -> ")}   min body: ${minChars} chars`);
  console.log("");
  console.log("  Claude Code:  ANTHROPIC_BASE_URL=http://127.0.0.1:" + port + " claude");
  console.log("  Codex:        set base_url in ~/.codex/config.toml (see README)");
  console.log("  OpenAI SDK:   baseURL: 'http://127.0.0.1:" + port + "/v1'");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (totalOriginal > 0) {
      const saved = totalOriginal - totalCompressed;
      console.log(`\ntotal saved this session: ${saved} tokens of ${totalOriginal}`);
    }
    server.close(() => process.exit(0));
  });
}

/**
 * Simulates Shubham's real setup: Claude Code -> token-saver proxy -> Databricks
 * AI Gateway mounted at /ai-gateway/anthropic, with the bearer token and the
 * x-databricks-use-coding-agent-mode header Claude Code sends.
 */
import http from "node:http";
import { spawn } from "node:child_process";

const ESC = String.fromCharCode(27);
const noisy = [
  ESC + "[32mnpm" + ESC + "[0m install running...",
  ...Array.from({ length: 60 }, (_, i) => "[####      ] downloading package-" + i + " 45%"),
  "added 2433 packages in 2m",
  "npm WARN deprecated glob@10.5.0",
].join("\n");

let seen = { path: "", auth: "", header: "", chars: 0 };
const gateway = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen = {
      path: req.url ?? "",
      auth: (req.headers.authorization as string) ?? "",
      header: (req.headers["x-databricks-use-coding-agent-mode"] as string) ?? "",
      chars: raw.length,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", model: "databricks-claude-opus-5" }));
  });
});
await new Promise<void>((r) => gateway.listen(9921, "127.0.0.1", r));

const proxy = spawn(process.execPath, ["--experimental-strip-types", "bin/proxy.ts"], {
  env: {
    ...process.env,
    PORT: "9922",
    TOKEN_SAVER_SHADOW: process.env.SIM_SHADOW ?? "",
    TOKEN_SAVER_LOG: process.env.SIM_LOG ?? "",
    TOKEN_SAVER_ANTHROPIC_URL: "http://127.0.0.1:9921/ai-gateway/anthropic",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
proxy.stdout.on("data", (d) => process.stdout.write("[proxy] " + d));
await new Promise((r) => setTimeout(r, 1500));

const body = JSON.stringify({
  model: "databricks-claude-opus-5",
  max_tokens: 4096,
  system: [{ type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "Install the deps." }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm install" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: noisy }] },
  ],
});

const res = await fetch("http://127.0.0.1:9922/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer dapi-fake-token",
    "anthropic-version": "2023-06-01",
    "x-databricks-use-coding-agent-mode": "true",
  },
  body,
});

console.log("client status      :", res.status, JSON.stringify(await res.json()));
console.log("gateway path       :", seen.path);
console.log("bearer forwarded   :", seen.auth === "Bearer dapi-fake-token");
console.log("databricks header  :", seen.header);
console.log("chars sent/received:", body.length, "->", seen.chars);
console.log("wire reduction     :", (((body.length - seen.chars) / body.length) * 100).toFixed(1) + "%");
console.log("body byte-identical:", seen.chars === body.length);

proxy.kill("SIGINT");
await new Promise((r) => setTimeout(r, 300));
gateway.close();
process.exit(0);

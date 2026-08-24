/** Boots the real CLI proxy against a fake upstream and drives one request through it. */
import http from "node:http";
import { spawn } from "node:child_process";

const ESC = String.fromCharCode(27);
const noisy = [
  ESC + "[32mnpm" + ESC + "[0m install running...",
  ...Array.from({ length: 60 }, (_, i) => "[####      ] downloading package-" + i + " 45%"),
  "added 2433 packages in 2m",
  "npm WARN deprecated glob@10.5.0",
].join("\n");

let receivedChars = 0;
const upstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    receivedChars = raw.length;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_1", content: [{ type: "text", text: "yes" }] }));
  });
});
await new Promise<void>((r) => upstream.listen(9911, "127.0.0.1", r));

const proxy = spawn(process.execPath, ["--experimental-strip-types", "bin/proxy.ts"], {
  env: { ...process.env, PORT: "9912", TOKEN_SAVER_ANTHROPIC_URL: "http://127.0.0.1:9911" },
  stdio: ["ignore", "pipe", "pipe"],
});
proxy.stdout.on("data", (d) => process.stdout.write("[proxy] " + d));
proxy.stderr.on("data", (d) => process.stderr.write("[proxy err] " + d));
await new Promise((r) => setTimeout(r, 1500));

const body = JSON.stringify({
  model: "claude-opus-4-6",
  max_tokens: 2048,
  system: [{ type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "Install the deps." }] },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm install" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: noisy }] },
  ],
});

const res = await fetch("http://127.0.0.1:9912/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": "sk-fake", "anthropic-version": "2023-06-01" },
  body,
});

console.log("client status:", res.status, "body:", JSON.stringify(await res.json()));
console.log("sent by client :", body.length, "chars");
console.log("seen upstream  :", receivedChars, "chars");
console.log("wire reduction :", (((body.length - receivedChars) / body.length) * 100).toFixed(1) + "%");

proxy.kill("SIGINT");
await new Promise((r) => setTimeout(r, 300));
upstream.close();
process.exit(0);

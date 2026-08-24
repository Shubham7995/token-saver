import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProxyServer } from "./server.ts";

const ESC = String.fromCharCode(27);
const noisyOutput = [
  `${ESC}[32mnpm${ESC}[0m install running...`,
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
].join("\n");

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

test("proxy streams an SSE response back chunk by chunk, unmodified", async () => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
    setTimeout(() => {
      res.write("event: content_block_delta\ndata: {\"text\":\"hi\"}\n\n");
      res.end("event: message_stop\ndata: {}\n\n");
    }, 20);
  });
  const upstreamPort = await listen(upstream);

  const proxy = createProxyServer({
    anthropicBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    onRequest: null,
  });
  const proxyPort = await listen(proxy);

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-4-6", stream: true, messages: [] }),
  });

  assert.equal(response.headers.get("content-type"), "text/event-stream");

  const chunks: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  const stream = chunks.join("");

  assert.match(stream, /message_start/);
  assert.match(stream, /content_block_delta/);
  assert.match(stream, /message_stop/);
  assert.ok(chunks.length > 1, `expected incremental delivery, got ${chunks.length} chunk(s)`);

  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

test("proxy compresses an Anthropic body before it reaches upstream", async () => {
  let received: Record<string, unknown> | null = null;
  let receivedAuth: string | undefined;

  const upstream = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received = JSON.parse(raw);
      receivedAuth = req.headers["x-api-key"] as string | undefined;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);

  const proxy = createProxyServer({ anthropicBaseUrl: `http://127.0.0.1:${upstreamPort}` });
  const proxyPort = await listen(proxy);

  const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "sk-test-key" },
    body: JSON.stringify({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        { role: "user", content: [{ type: "text", text: "Did it work?" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm i" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: noisyOutput }],
        },
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const forwarded = JSON.stringify(received);
  assert.doesNotMatch(forwarded, /downloading package-20/, "progress bars should be stripped");
  assert.match(forwarded, /added 2433 packages/, "the summary line must survive");
  assert.match(forwarded, /toolu_1/, "tool linkage must survive");
  assert.equal(receivedAuth, "sk-test-key", "client credentials pass through untouched");

  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

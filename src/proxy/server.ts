/**
 * token-saver proxy — sits between a coding agent (Claude Code, Codex, or any
 * OpenAI-compatible client) and the real API. It compresses the request body,
 * forwards it upstream with the client's own credentials untouched, and streams
 * the response straight back.
 *
 * Only the REQUEST is rewritten. The response is a dumb pipe, so streaming,
 * tool calls, and every response field behave exactly as they would without it.
 */
import http from "node:http";
import { compress } from "../index.ts";
import { agentConfig, wireForPath, type AgentWire } from "./policy.ts";

export interface ProxyOptions {
  /** Upstream for /v1/messages. Default: https://api.anthropic.com */
  anthropicBaseUrl?: string;
  /** Upstream for /v1/responses and /v1/chat/completions. Default: https://api.openai.com */
  openaiBaseUrl?: string;
  /** Engines to run. Default: ["rtk"] — see agentConfig() for why. */
  engines?: string[];
  /** Bodies smaller than this many characters are forwarded untouched. */
  minChars?: number;
  /** Per-request log line. Set to null to silence. */
  onRequest?: ((line: string) => void) | null;
}

/** Headers that describe the body we are about to replace, or the hop itself. */
const STRIPPED_HEADERS = new Set([
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "accept-encoding",
]);

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function forwardHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (STRIPPED_HEADERS.has(key.toLowerCase())) continue;
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

function baseUrlFor(wire: AgentWire | null, options: ProxyOptions): string {
  if (wire === "anthropic") {
    return options.anthropicBaseUrl ?? process.env.TOKEN_SAVER_ANTHROPIC_URL ?? "https://api.anthropic.com";
  }
  return options.openaiBaseUrl ?? process.env.TOKEN_SAVER_OPENAI_URL ?? "https://api.openai.com";
}

/**
 * Join an upstream base URL with the incoming request path, KEEPING any path
 * prefix the base URL carries. Corporate gateways mount the API under a prefix
 * (Databricks: https://host/ai-gateway/anthropic), and `new URL(path, base)`
 * would discard it and send /v1/messages to the host root.
 */
export function joinUpstream(baseUrl: string, requestPath: string): URL {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const [pathname, query] = requestPath.split("?");
  const target = new URL(base.origin);
  target.pathname = `${prefix}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  if (query) target.search = query;
  return target;
}

export function createProxyServer(options: ProxyOptions = {}): http.Server {
  const engines = options.engines ?? ["rtk"];
  const minChars = options.minChars ?? 2_000;
  const log = options.onRequest === null ? () => {} : (options.onRequest ?? console.log);

  return http.createServer(async (req, res) => {
    try {
      const path = req.url ?? "/";
      const wire = wireForPath(path);
      const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);

      let outgoing = raw;
      let note = "passthrough";

      if (wire && raw.length >= minChars) {
        try {
          const body = JSON.parse(raw) as Record<string, unknown>;
          const result = await compress(body, {
            config: agentConfig(engines),
            ...(wire === "openai-responses"
              ? { sourceFormat: "openai-responses", targetFormat: "openai-responses" }
              : {}),
          } as never);
          if (result.compressed) {
            outgoing = JSON.stringify(result.body);
            const saved = result.stats?.savingsPercent ?? 0;
            note = `${result.stats?.originalTokens ?? "?"} -> ${result.stats?.compressedTokens ?? "?"} tok (${saved}%)`;
          } else {
            note = "nothing to compress";
          }
        } catch (error) {
          // A malformed or unexpected body must never break the agent: forward it as-is.
          note = `compression skipped (${(error as Error).message})`;
          outgoing = raw;
        }
      }

      const target = joinUpstream(baseUrlFor(wire, options), path);
      const headers = forwardHeaders(req);
      if (outgoing) headers["content-length"] = String(Buffer.byteLength(outgoing));

      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: outgoing || undefined,
        redirect: "manual",
      });

      log(`${req.method} ${path} -> ${upstream.status}  ${note}`);

      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() === "content-encoding") return;
        responseHeaders[key] = value;
      });
      res.writeHead(upstream.status, responseHeaders);

      if (!upstream.body) {
        res.end();
        return;
      }
      // Stream SSE and JSON alike, chunk by chunk, unmodified.
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `token-saver proxy: ${(error as Error).message}` } }));
    }
  });
}

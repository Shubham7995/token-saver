# token-saver

OmniRoute's prompt-compression engine stack, extracted as a standalone package.

Give it a request body, get a smaller one back, then send that to whatever model you want.
Use it as a library, or run the bundled proxy and point **Claude Code**, **Codex**, or any
OpenAI-compatible client at it. Nothing is tied to OmniRoute's gateway, dashboard, or database
anymore.

All three wire formats are supported and tested: Anthropic Messages (Claude Code, **77–84%**
saved), OpenAI Responses (Codex, **89.7%**), and OpenAI chat completions (**67.9%**).

Extracted from [OmniRoute](https://github.com/diegosouzapw/OmniRoute) v3.8.50 (MIT — see
`LICENSE.omniroute`). 6 runtime npm packages instead of 2433.

---

## Is it plug and play?

Yes, with one honest caveat: **compression quality depends on what your payload looks like.**

- `npm install` and call `compress(body)` — no API keys, no database, no Python, no model
  downloads, no build step, no daemon.
- The default stack (RTK → Caveman) is the one OmniRoute ships. On a request whose bulk is
  command/tool output it cuts **60–95%**. On short hand-written prose it cuts ~5–10%,
  because there is simply less noise to remove.
- 7 of the 12 engines work with zero extra setup. 5 need specific conditions (a Responses-API
  body, a vision model, optional ONNX model packs). See the engine table.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **≥ 22.18** (tested on 22.22.2 and 24.19.0) | Needs native TypeScript stripping (`--experimental-strip-types`) |
| npm | any current | `npm install` only; no native compilation, no postinstall scripts |
| OS | any | Pure JS. No native addons, no `better-sqlite3`, no Python |

No API key. No network access at runtime. No GPU.

If you are on Node < 22.18 or want plain JS, run the source through `tsx`, `esbuild`, or `tsc`
— nothing in the package depends on running as TypeScript.

## External dependencies

All 6 are ordinary npm packages, installed by `npm install`:

| Package | Used by |
|---|---|
| `js-tiktoken` | token counting for stats and budget gates |
| `zod` | RTK filter schema validation |
| `smol-toml` | parsing user-supplied `.rtk/filters.toml` |
| `safe-regex` | rejecting catastrophic user-supplied regexes (ReDoS guard) |
| `@toon-format/toon` | the Headroom engine's table encoding |
| `omniglyph` | the OmniGlyph engine |

Dev-only: `typescript`, `@types/node`.

**Optional, not installed:** the LLMLingua-2 and Ultra-SLM tiers want ONNX model packs
(`onnxruntime-node` + a downloaded model). Without them those engines fail open — they return
the body unchanged rather than erroring. Everything else runs.

---

## Install

```bash
git clone <this repo>
cd token-saver
npm install
npm test          # 8 unit tests
npm run proxy     # start the Claude Code / Codex proxy
npm run smoke     # end-to-end, prints before/after token counts
```

## Use

```ts
import { compress } from "./src/index.ts";

const requestBody = {
  model: "qwen2.5-coder",
  messages: [
    { role: "user", content: "Did the install succeed?" },
    { role: "tool", tool_call_id: "call_1", content: hugeNoisyCommandOutput },
  ],
};

const result = await compress(requestBody);

result.body;       // compressed request body — same shape, send it as-is
result.compressed; // false when nothing was worth changing
result.stats;      // { originalTokens, compressedTokens, savingsPercent, engineBreakdown }
```

Then forward it to your local model:

```ts
const response = await fetch("http://localhost:11434/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(result.body),
});
```

### Watching each engine work

```ts
await compress(body, {
  onEngineStep: (step) =>
    console.log(`${step.engine}: ${step.originalTokens} → ${step.compressedTokens}`),
});
```

### Choosing engines

```ts
import { compress, defaultStackedConfig } from "./src/index.ts";

await compress(body, {
  config: defaultStackedConfig({
    stackedPipeline: [
      { engine: "session-dedup" },
      { engine: "rtk", intensity: "aggressive" },
      { engine: "caveman", intensity: "full" },
    ],
    engines: {
      "session-dedup": { enabled: true },
      rtk: { enabled: true },
      caveman: { enabled: true },
    },
  }),
});
```

Single engine, no stack:

```ts
await compress(body, { mode: "rtk" });   // or "lite" | "aggressive" | "ultra" | "omniglyph"
```

### Compressing raw text instead of a request body

```ts
import { processRtkText } from "./src/engine/engines/rtk/index.ts";
import { cavemanCompress } from "./src/engine/caveman.ts";
```

---

## Use it with Claude Code and Codex

Compression cannot be a Claude Code plugin: hooks fire around *tool* events, and none of them
can rewrite the request that goes to the model. `PostToolUse` cannot replace a tool result, and
`PreToolUse.updatedInput` only edits a tool's **input**. So token-saver ships a **local proxy**
instead — both CLIs already support pointing at a custom base URL.

```bash
npm run proxy        # http://127.0.0.1:8787
```

It compresses the request, forwards it upstream with **your own credentials untouched** (no key
is read or stored by the proxy), and streams the response straight back. Only the request is
rewritten; responses, streaming, and tool calls are a byte-for-byte pipe.

### Claude Code

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

Verified through the real proxy binary with a Claude-Code-shaped request:
**745 → 122 tokens (83.6%)**, `tool_use_id`, `cache_control` and the system block intact.

### Start in shadow mode

Before trusting compression with real work, run it in **shadow mode**: the proxy compresses each
body to learn what it *would* save, then forwards the byte-identical original. Nothing your agent
sends is altered, so there is no quality or cache risk — you just get real numbers from your own
traffic instead of a README's fixtures.

```bash
TOKEN_SAVER_SHADOW=1 TOKEN_SAVER_LOG=./shadow.jsonl npm run proxy
```

Work normally for a day, then Ctrl-C for the session report — shape shown here with
placeholder figures, since the only numbers that matter are the ones from your own traffic:

```
──────── token-saver session report ────────
mode                : shadow (nothing was changed)
requests seen       : N
compressible        : N  (% of requests)
tokens in           : N
tokens out          : N
saved               : N  (%)
best / worst request: % / %
────────────────────────────────────────────
```

`shadow.jsonl` holds one JSON record per request for your own analysis.

**Read the number honestly.** It counts request tokens only and ignores prompt-cache economics —
a cached prefix bills at a fraction of an uncached one, so this is an *upper bound* on what
compression can win you, not a bill delta. If the figure is small, your traffic is dominated by
file reads and prose rather than command output, and compression is not your bottleneck.

Drop `TOKEN_SAVER_SHADOW=1` to switch the same setup to active.

### Claude Code behind a corporate gateway

If `ANTHROPIC_BASE_URL` already points at a company gateway (Databricks AI Gateway, LiteLLM,
Bedrock proxy…), chain the proxy in front of it — the base-URL slot moves to token-saver and the
gateway becomes token-saver's upstream:

```bash
TOKEN_SAVER_ANTHROPIC_URL=https://<host>/ai-gateway/anthropic npm run proxy
```

`settings.json`:

```jsonc
"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787",   // was the gateway URL
  "ANTHROPIC_AUTH_TOKEN": "…",                     // unchanged — forwarded as-is
  "ANTHROPIC_CUSTOM_HEADERS": "x-databricks-use-coding-agent-mode: true"  // unchanged
}
```

Gateway base paths are preserved: a request to `/v1/messages` with an upstream of
`https://host/ai-gateway/anthropic` is forwarded to
`https://host/ai-gateway/anthropic/v1/messages`, not to the host root. Auth tokens and custom
headers pass through untouched. Verified end to end against a simulated Databricks gateway:
**747 → 124 tokens (83.4%)**, bearer token and `x-databricks-use-coding-agent-mode` intact.

**Caveat:** Claude Code now depends on the proxy being up. If it is not running, requests fail
with a connection error until you start it or restore the original base URL.

### Codex

`~/.codex/config.toml`:

```toml
model = "gpt-5-codex"
model_provider = "tokensaver"

[model_providers.tokensaver]
name = "token-saver"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```

Verified on a Responses-API body: **89.7%** saved, `call_id` linkage intact.

### Any OpenAI-compatible client

```ts
new OpenAI({ baseURL: "http://127.0.0.1:8787/v1", apiKey: process.env.OPENAI_API_KEY });
```

### Proxy settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port (binds `127.0.0.1` only) |
| `TOKEN_SAVER_SHADOW` | unset | `1` = measure only, forward the original body unchanged |
| `TOKEN_SAVER_LOG` | unset | Append one JSON record per request to this file |
| `TOKEN_SAVER_ENGINES` | `rtk` | Comma-separated engine ids, run in order |
| `TOKEN_SAVER_MIN_CHARS` | `2000` | Bodies smaller than this pass through untouched |
| `TOKEN_SAVER_ANTHROPIC_URL` | `https://api.anthropic.com` | Upstream for `/v1/messages` |
| `TOKEN_SAVER_OPENAI_URL` | `https://api.openai.com` | Upstream for `/v1/responses`, `/v1/chat/completions` |

### Why the default is RTK only

Claude Code and Codex both lean on upstream **prompt caching**, where re-reading a cached prefix
costs a fraction of a fresh read. That makes *stability* worth more than raw ratio:

- **RTK is deterministic per tool result.** Re-compressing an older turn yields the same bytes,
  so the cached prefix still matches — you keep the cache *and* the savings. It is also the
  engine doing 80–90% of the work on agent traffic, which is mostly command and file output.
- **Cross-turn engines rewrite history.** `session-dedup`, `relevance` and `ccr` change earlier
  turns as the conversation grows, so the prefix differs on every request and the cache is
  forfeited. That can cost more than the compression saves.
- **Caveman is off** because mangling your own prose for a few percent is a bad trade when you
  are paying for the model to understand you precisely.

Turn more on when you know the tradeoff — `TOKEN_SAVER_ENGINES=rtk,caveman`.

An unparseable or unexpected body is always forwarded unchanged rather than erroring, so a bad
request degrades to plain proxying instead of breaking your session.

---

## The 12 engines

`stackPriority` fixes the order when several run together. "Lossy" means the engine can drop
content a later turn might have wanted.

| # | Engine | Lossy | What it does | Status here |
|---|---|---|---|---|
| 1 | `session-dedup` | no | Elides multi-line blocks already sent earlier in the conversation | **verified 47%** |
| 2 | `ccr` | no | Replaces large repeated blocks with content-addressed markers, retrievable on request | needs a client that speaks the CCR retrieval protocol |
| 3 | `lite` | no | Whitespace / formatting cleanup | works, small effect (<1% here) |
| 4 | `rtk` | partly | Filters command & tool output: ANSI codes, progress bars, repeated lines — keeps failures, warnings, summaries | **verified 93% on raw output** |
| 5 | `codex-responses` | partly | Trims OpenAI **Responses API** tool payloads | needs a Responses-API body (`input[]`), not `messages[]` |
| 6 | `headroom` | yes | Re-encodes bulky structured data as TOON to fit a token budget | needs tabular payloads + a budget |
| 7 | `relevance` | yes | Drops history with low relevance to the current question | **verified 29%** |
| 8 | `caveman` | yes | Strips filler words, articles, hedging from prose (rule packs, 9 languages) | **verified 6–13%** |
| 9 | `aggressive` | yes | Heavier prose reduction | **verified 23–25%** |
| 10 | `llmlingua` | yes | LLMLingua-2 token pruning | needs optional ONNX model packs |
| 11 | `ultra` | yes | Maximum reduction — heuristic tier by default, SLM tier when packs exist | **verified 17% (heuristic)** |
| 12 | `omniglyph` | yes | Encodes text as semantic glyph images | needs a vision model + direct provider transport |

Three more engines register but are not in the catalog: `ionizer`, `llm` (model-backed
summarization — you supply the model call), `read-lifecycle`.

**Always protected**, whatever runs: code blocks, inline code, URLs, file paths, JSON, and
error/stack lines (`src/engine/preservation.ts`). System prompts are preserved by default
(`preserveSystemPrompt: true`) so prompt caching upstream is not broken.

### Enabling an engine — the part that trips people up

An engine only runs when it is switched on in **three** places:

1. `stackedPipeline` — the ordered step list
2. `engines[id].enabled` — the master toggle map
3. the engine's own settings — either its config block (`rtkConfig`, `cavemanConfig`, …) or the
   `stepConfig` passed to `engine.apply()`

`defaultStackedConfig()` wires all three for the RTK → Caveman stack. Copy its shape when you
add engines. If an engine silently returns `compressed: false`, one of the three is missing.

---

## Verified results

`npm run smoke` — a request with 40 lines of noisy `npm install` output plus filler-heavy prose:

```
step rtk:      629 → 210 tokens  (66.6%)
step caveman:  129 → 121 tokens  ( 6.2%)
total:         629 → 202 tokens  (67.9% saved)
```

RTK alone on the raw command output: **433 → 28 tokens (93.5%)** — and it kept the
`added 2433 packages` summary line and the deprecation warning, dropping only the 40 progress
bars and ANSI escapes.

Probe scripts used to produce the per-engine numbers above are in `scripts/`.

---

## How it was extracted

- `src/engine/**` — verbatim copy of OmniRoute's `open-sse/services/compression/` (123 files,
  ~24k LOC), minus `eval/` and `harness/`, which reached into OmniRoute's provider executors.
- `src/shim/**` — the six imports that escaped that directory. Five are verbatim copies
  (`tiktokenCounter`, `cacheControlPolicy`, `routingStrategies`, `visionModels`,
  `optionalPacks`). The sixth, `ccrBlocks`, replaces the SQLite-backed CCR store with an
  in-memory `Map` behind the same exported API — process-local, so swap it for Redis or SQLite
  if you need sharing across processes.
- **One real bug fixed.** `ruleLoader.ts` and `engines/rtk/filterLoader.ts` located their rule
  packs by walking up the tree looking for an `open-sse/services/compression` directory. Outside
  OmniRoute that search finds nothing, the loaders return an empty filter set, and every filter
  silently becomes a no-op — RTK reported success while saving 0%. Both now check their own
  module directory first. That one change is the difference between 0% and 93%.

## Layout

```
src/index.ts        public API: compress(), defaultStackedConfig()
src/engine/         the pipeline (verbatim OmniRoute, 2 loader paths patched)
  engineCatalog.ts  the 12 engines + their tradeoffs
  strategySelector.ts  stacked pipeline orchestration
  types.ts          CompressionConfig and every engine config type
  engines/          one directory per engine
  rules/            caveman rule packs, 9 languages
  engines/rtk/filters/  55 builtin command filters (npm, git, docker, cargo, …)
src/proxy/          the Claude Code / Codex proxy (policy + server)
src/shim/           the OmniRoute seams, re-implemented or copied
bin/proxy.ts        proxy launcher (npm run proxy)
scripts/            smoke test + per-engine probes
```

## License

The extracted code is MIT, from OmniRoute — `LICENSE.omniroute` is the upstream license and
must stay with it. Credit: [@diegosouzapw](https://github.com/diegosouzapw).

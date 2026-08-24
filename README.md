# token-saver

OmniRoute's prompt-compression engine stack, extracted as a standalone package.

Give it an OpenAI-style chat-completions request body, get a smaller one back, then send that
to whatever model you want — Ollama, llama.cpp, vLLM, LM Studio, or a hosted API. Nothing
about the pipeline is tied to OmniRoute's gateway, dashboard, or database anymore.

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
npm test          # 4 unit tests
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
src/shim/           the OmniRoute seams, re-implemented or copied
scripts/            smoke test + per-engine probes
```

## License

The extracted code is MIT, from OmniRoute — `LICENSE.omniroute` is the upstream license and
must stay with it. Credit: [@diegosouzapw](https://github.com/diegosouzapw).

/**
 * Runs every catalog engine on its own against one fixture and reports whether it
 * works with nothing but this package's npm dependencies installed.
 */
import { applyCompressionAsync } from "../src/engine/strategySelector.ts";
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import { DEFAULT_COMPRESSION_CONFIG, type CompressionConfig } from "../src/engine/types.ts";
import { ENGINE_CATALOG } from "../src/engine/engineCatalog.ts";

registerBuiltinCompressionEngines();

const ESC = String.fromCharCode(27);
const toolOutput = [
  `${ESC}[32mnpm${ESC}[0m install running...`,
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
  "found 0 vulnerabilities",
].join("\n");

const prose =
  "Basically, I would really just like you to actually summarize what happened in that log " +
  "output above, and then simply tell me whether or not I should really be worried about it.";

function fixture() {
  return {
    model: "local-model",
    messages: [
      { role: "system", content: "You are a helpful assistant that is always very careful." },
      { role: "user", content: prose },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: JSON.stringify({ command: "npm install" }) },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: toolOutput },
      { role: "user", content: prose },
    ],
  };
}

function configFor(id: string): CompressionConfig {
  return {
    ...DEFAULT_COMPRESSION_CONFIG,
    enabled: true,
    defaultMode: "stacked",
    preserveSystemPrompt: false,
    preserveSystemPromptMode: "never",
    stackedPipeline: [{ engine: id }],
    engines: { ...DEFAULT_COMPRESSION_CONFIG.engines, [id]: { enabled: true } },
    rtkConfig: { ...DEFAULT_COMPRESSION_CONFIG.rtkConfig, enabled: true, intensity: "aggressive" },
    cavemanConfig: {
      enabled: true,
      compressRoles: ["user", "assistant", "system"],
      skipRules: [],
      minMessageLength: 20,
      preservePatterns: [],
      intensity: "full",
    },
    relevanceConfig: { enabled: true },
    headroom: { enabled: true, minRows: 2 },
    sessionDedup: { enabled: true, minBlockChars: 100 },
    ccr: { enabled: true, minChars: 200 },
    lite: { compressToolResults: true },
    aggressive: { enabled: true },
    ultra: { enabled: true },
    ultraEngine: "heuristic",
    enginesExplicit: true,
  } as CompressionConfig;
}

import { getEngine } from "../src/engine/engines/registry.ts";

for (const id of Object.keys(ENGINE_CATALOG)) {
  try {
    const result = await applyCompressionAsync(fixture(), "stacked", {
      model: "local-model",
      principalId: "matrix",
      config: configFor(id),
    });
    const pct = result.stats?.savingsPercent ?? 0;
    console.log(
      `${id.padEnd(16)} ${result.compressed ? "ran" : "no-op"}  savings=${String(pct).padStart(6)}%`
    );
  } catch (error) {
    console.log(`${id.padEnd(16)} ERROR  ${(error as Error).message.slice(0, 120)}`);
  }
}

/** Calls each engine's own apply() directly, bypassing pipeline gating. */
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import { getEngine } from "../src/engine/engines/registry.ts";
import { ENGINE_CATALOG } from "../src/engine/engineCatalog.ts";
import { DEFAULT_COMPRESSION_CONFIG, type CompressionConfig } from "../src/engine/types.ts";

registerBuiltinCompressionEngines();

const ESC = String.fromCharCode(27);
const toolOutput = [
  `${ESC}[32mnpm${ESC}[0m install running...`,
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
].join("\n");
const prose =
  "Basically, I would really just like you to actually summarize what happened in that log " +
  "output above, and then simply tell me whether or not I should really be worried about it.";
const bigBlock = "The quick brown fox jumps over the lazy dog. ".repeat(40);

function fixture() {
  return {
    model: "local-model",
    messages: [
      { role: "system", content: "You are a helpful assistant that is always very careful." },
      { role: "user", content: prose },
      { role: "assistant", content: bigBlock },
      { role: "user", content: bigBlock },
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

const config = {
  ...DEFAULT_COMPRESSION_CONFIG,
  enabled: true,
  preserveSystemPrompt: false,
  preserveSystemPromptMode: "never",
  rtkConfig: { ...DEFAULT_COMPRESSION_CONFIG.rtkConfig, enabled: true, intensity: "aggressive" },
  cavemanConfig: {
    enabled: true,
    compressRoles: ["user", "assistant", "system"],
    skipRules: [],
    minMessageLength: 20,
    preservePatterns: [],
    intensity: "full",
  },
  lite: { compressToolResults: true },
  headroom: { enabled: true },
  sessionDedup: { enabled: true },
  ccr: { enabled: true, minChars: 200 },
  ultra: { enabled: true },
  aggressive: { enabled: true },
  relevanceConfig: { enabled: true },
  ultraEngine: "heuristic",
} as CompressionConfig;

for (const id of Object.keys(ENGINE_CATALOG)) {
  const engine = getEngine(id);
  if (!engine) {
    console.log(`${id.padEnd(16)} NOT REGISTERED`);
    continue;
  }
  try {
    const result = await engine.apply(fixture(), {
      model: "local-model",
      principalId: "direct",
      config,
    });
    const pct = result?.stats?.savingsPercent ?? 0;
    console.log(
      `${id.padEnd(16)} ${result?.compressed ? "ran  " : "no-op"} ${String(pct).padStart(6)}%`
    );
  } catch (error) {
    console.log(`${id.padEnd(16)} ERROR ${(error as Error).message.slice(0, 100)}`);
  }
}

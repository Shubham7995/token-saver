/** Engines read per-step settings from options.stepConfig — probe them that way. */
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import { getEngine } from "../src/engine/engines/registry.ts";
import { ENGINE_CATALOG } from "../src/engine/engineCatalog.ts";
import { DEFAULT_COMPRESSION_CONFIG, type CompressionConfig } from "../src/engine/types.ts";

registerBuiltinCompressionEngines();

const ESC = String.fromCharCode(27);
const toolOutput = [
  ESC + "[32mnpm" + ESC + "[0m install running...",
  ...Array.from({ length: 40 }, (_, i) => "[####      ] downloading package-" + i + " 45%"),
  "added 2433 packages in 2m",
].join("\n");
const repeated = Array.from(
  { length: 30 },
  (_, i) => "line " + i + ": the quick brown fox jumps over the lazy dog and keeps running"
).join("\n");
const prose =
  "Basically, I would really just like you to actually summarize what happened in that log " +
  "output above, and then simply tell me whether or not I should really be worried about it.";

function fixture() {
  return {
    model: "local-model",
    messages: [
      { role: "system", content: "You are a helpful assistant that is always very careful." },
      { role: "user", content: repeated },
      { role: "assistant", content: "Understood. " + repeated },
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
      { role: "user", content: prose + "\n" + repeated },
    ],
  };
}

const config = {
  ...DEFAULT_COMPRESSION_CONFIG,
  enabled: true,
  preserveSystemPrompt: false,
  preserveSystemPromptMode: "never",
} as CompressionConfig;

const stepConfigs: Record<string, Record<string, unknown>> = {
  "session-dedup": { enabled: true, minBlockChars: 80 },
  ccr: { enabled: true, minChars: 200 },
  lite: { enabled: true, compressToolResults: true },
  rtk: { enabled: true, intensity: "aggressive" },
  "codex-responses": { enabled: true },
  headroom: { enabled: true },
  relevance: { enabled: true },
  caveman: { enabled: true, intensity: "full", compressRoles: ["user", "assistant", "system"] },
  aggressive: { enabled: true },
  llmlingua: { enabled: true },
  ultra: { enabled: true },
  omniglyph: { enabled: true },
};

for (const id of Object.keys(ENGINE_CATALOG)) {
  const engine = getEngine(id);
  try {
    const result = await engine.apply(fixture(), {
      model: "local-model",
      principalId: "probe",
      providerTransport: "direct",
      config,
      stepConfig: stepConfigs[id],
    });
    const pct = result?.stats?.savingsPercent ?? 0;
    console.log(id.padEnd(16) + (result?.compressed ? "ran  " : "no-op") + " " + String(pct).padStart(6) + "%");
  } catch (error) {
    console.log(id.padEnd(16) + "ERROR " + (error as Error).message.slice(0, 90));
  }
}

/**
 * End-to-end proof that the extracted pipeline still compresses:
 * feeds one OpenAI-style request body through the stacked RTK -> Caveman stack
 * and prints the before/after token estimates.
 */
import { applyCompressionAsync } from "../src/engine/strategySelector.ts";
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import {
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_RTK_CONFIG,
  DEFAULT_CAVEMAN_CONFIG,
} from "../src/engine/types.ts";
import { estimateCompressionTokens } from "../src/engine/stats.ts";

registerBuiltinCompressionEngines();

const toolOutput = [
  "[32mnpm[0m install running...",
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
  "WARN deprecated glob@10.5.0: old versions are not supported",
  "found 0 vulnerabilities",
].join("\n");

const body = {
  model: "local-model",
  messages: [
    {
      role: "system",
      content:
        "You are a very helpful assistant. Please make sure that you always answer the user's questions carefully and thoroughly, and remember that it is really important to be accurate.",
    },
    { role: "user", content: "Did the install succeed? Here is the log." },
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
    {
      role: "user",
      content:
        "Basically, I would really just like you to actually summarize what happened in that log output above, and then simply tell me whether or not I should be worried about any of it.",
    },
  ],
};

const before = estimateCompressionTokens(JSON.stringify(body));

const result = await applyCompressionAsync(body, "stacked", {
  model: "local-model",
  config: {
    ...DEFAULT_COMPRESSION_CONFIG,
    enabled: true,
    defaultMode: "stacked",
    stackedPipeline: [
      { engine: "rtk", intensity: "aggressive" },
      { engine: "caveman", intensity: "full" },
    ],
    engines: {
      ...DEFAULT_COMPRESSION_CONFIG.engines,
      rtk: { enabled: true },
      caveman: { enabled: true },
    },
    rtkConfig: { ...DEFAULT_RTK_CONFIG, enabled: true, intensity: "aggressive" },
    cavemanConfig: {
      ...DEFAULT_CAVEMAN_CONFIG,
      enabled: true,
      intensity: "full",
      compressRoles: ["user", "assistant"],
    },
  },
  onEngineStep: (step) => {
    console.log(`  step ${step.engine}: ${JSON.stringify(step).slice(0, 160)}`);
  },
});

const after = estimateCompressionTokens(JSON.stringify(result.body));

console.log("compressed:", result.compressed);
console.log("tokens before:", before);
console.log("tokens after: ", after);
console.log("saved:", `${(((before - after) / before) * 100).toFixed(1)}%`);
console.log("stats:", JSON.stringify(result.stats, null, 2).slice(0, 800));

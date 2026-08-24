/** Does the pipeline understand Anthropic Messages API bodies (what Claude Code sends)? */
import { compress } from "../src/index.ts";

const ESC = String.fromCharCode(27);
const toolOutput = [
  ESC + "[32mnpm" + ESC + "[0m install running...",
  ...Array.from({ length: 40 }, (_, i) => "[####      ] downloading package-" + i + " 45%"),
  "added 2433 packages in 2m",
  "found 0 vulnerabilities",
].join("\n");

const anthropicBody = {
  model: "claude-opus-4-6",
  max_tokens: 4096,
  system: [{ type: "text", text: "You are Claude Code.", cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: [{ type: "text", text: "Did the install succeed?" }] },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "npm install" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: toolOutput }],
    },
  ],
};

const result = await compress(anthropicBody, {
  onEngineStep: (s) => console.log("  " + s.engine + ": " + s.state + " " + s.savingsPercent + "%"),
});

console.log("compressed:", result.compressed, "savings:", result.stats?.savingsPercent + "%");
const out = JSON.stringify(result.body);
console.log("tool_use_id intact:", out.includes("toolu_1"));
console.log("cache_control intact:", out.includes("cache_control"));
console.log("summary line kept:", out.includes("added 2433 packages"));
console.log("progress bars gone:", !out.includes("downloading package-20"));

/** Codex CLI sends OpenAI Responses API bodies (input[], function_call_output). */
import { compress } from "../src/index.ts";

const ESC = String.fromCharCode(27);
const toolOutput = [
  ESC + "[32mnpm" + ESC + "[0m install running...",
  ...Array.from({ length: 40 }, (_, i) => "[####      ] downloading package-" + i + " 45%"),
  "added 2433 packages in 2m",
].join("\n");

const responsesBody = {
  model: "gpt-5-codex",
  instructions: "You are Codex.",
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Install deps." }] },
    { type: "function_call", call_id: "call_1", name: "shell", arguments: '{"command":"npm install"}' },
    { type: "function_call_output", call_id: "call_1", output: toolOutput },
  ],
};

const result = await compress(responsesBody, {
  sourceFormat: "openai-responses",
  targetFormat: "openai-responses",
  onEngineStep: (s) => console.log("  " + s.engine + ": " + s.state + " " + s.savingsPercent + "%"),
} as never);

console.log("compressed:", result.compressed, "savings:", result.stats?.savingsPercent + "%");
const out = JSON.stringify(result.body);
console.log("call_id intact:", out.includes("call_1"));
console.log("summary kept:", out.includes("added 2433 packages"));
console.log("progress gone:", !out.includes("downloading package-20"));

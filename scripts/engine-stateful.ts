/**
 * session-dedup and ccr only pay off on the SECOND request that repeats a block,
 * and codex-responses only sees Responses-API bodies. Probe those properly.
 */
import { registerBuiltinCompressionEngines } from "../src/engine/engines/index.ts";
import { getEngine } from "../src/engine/engines/registry.ts";
import { DEFAULT_COMPRESSION_CONFIG, type CompressionConfig } from "../src/engine/types.ts";

registerBuiltinCompressionEngines();

const bigBlock = Array.from({ length: 30 }, (_, i) => "line " + i + ": the quick brown fox jumps over the lazy dog and keeps running").join("\n");

const config = {
  ...DEFAULT_COMPRESSION_CONFIG,
  enabled: true,
  preserveSystemPrompt: false,
  preserveSystemPromptMode: "never",
  sessionDedup: { enabled: true },
  ccr: { enabled: true, minChars: 200 },
} as CompressionConfig;

function chatBody() {
  return {
    model: "local-model",
    messages: [
      { role: "user", content: bigBlock },
      { role: "assistant", content: "Understood." },
      { role: "user", content: bigBlock + "\nNow answer the question." },
    ],
  };
}

for (const id of ["session-dedup", "ccr"]) {
  const engine = getEngine(id);
  const opts = { model: "local-model", principalId: "stateful-probe", config };
  const first = await engine.apply(chatBody(), opts);
  const second = await engine.apply(chatBody(), opts);
  console.log(
    id.padEnd(14) +
      " call1=" + (first?.compressed ? "ran" : "no-op") + " " + (first?.stats?.savingsPercent ?? 0) + "%" +
      "  call2=" + (second?.compressed ? "ran" : "no-op") + " " + (second?.stats?.savingsPercent ?? 0) + "%"
  );
}

const responsesBody = {
  model: "local-model",
  input: [
    { role: "user", content: [{ type: "input_text", text: bigBlock }] },
    { type: "function_call_output", call_id: "call_1", output: bigBlock + "\ndone in 2m" },
  ],
};

const codex = await getEngine("codex-responses").apply(responsesBody, {
  model: "local-model",
  principalId: "stateful-probe",
  sourceFormat: "openai-responses",
  targetFormat: "openai-responses",
  config: {
    ...config,
    codexResponsesConfig: { ...DEFAULT_COMPRESSION_CONFIG.codexResponsesConfig, enabled: true },
  } as CompressionConfig,
});
console.log("codex-responses " + (codex?.compressed ? "ran" : "no-op") + " " + (codex?.stats?.savingsPercent ?? 0) + "%");

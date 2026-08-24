import { test } from "node:test";
import assert from "node:assert/strict";
import { wireForPath, agentConfig } from "./policy.ts";

test("wireForPath maps each agent's endpoint to its wire format", () => {
  assert.equal(wireForPath("/v1/messages"), "anthropic");
  assert.equal(wireForPath("/v1/responses"), "openai-responses");
  assert.equal(wireForPath("/v1/chat/completions"), "openai-chat");
  assert.equal(wireForPath("/v1/models"), null);
});

test("the coding-agent config is cache-safe: RTK only, system prompt preserved", () => {
  const config = agentConfig();

  assert.deepEqual(
    config.stackedPipeline.map((step) => step.engine),
    ["rtk"],
    "cross-turn engines churn the cached prefix and must stay off by default"
  );
  assert.equal(config.preserveSystemPrompt, true);
  assert.equal(config.engines.rtk.enabled, true);
  assert.equal(config.engines["session-dedup"]?.enabled ?? false, false);
  assert.equal(config.engines.relevance?.enabled ?? false, false);
  assert.equal(config.rtkConfig.enabled, true);
});

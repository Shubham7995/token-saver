import { test } from "node:test";
import assert from "node:assert/strict";
import { compress } from "./index.ts";

const ESC = String.fromCharCode(27);

const noisyToolOutput = [
  `${ESC}[32mnpm${ESC}[0m install running...`,
  ...Array.from({ length: 40 }, (_, i) => `[####      ] downloading package-${i} 45%`),
  "added 2433 packages in 2m",
  "found 0 vulnerabilities",
].join("\n");

test("compress shrinks a noisy tool result and keeps the summary line", async () => {
  const result = await compress({
    model: "local-model",
    messages: [
      { role: "user", content: "Did the install succeed?" },
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
      { role: "tool", tool_call_id: "call_1", content: noisyToolOutput },
    ],
  });

  assert.equal(result.compressed, true);
  assert.ok(
    result.stats.savingsPercent > 30,
    `expected >30% savings, got ${result.stats.savingsPercent}`
  );
  assert.match(JSON.stringify(result.body), /added 2433 packages/);
  assert.doesNotMatch(JSON.stringify(result.body), /downloading package-20/);
});

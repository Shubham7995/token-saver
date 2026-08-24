import { test } from "node:test";
import assert from "node:assert/strict";
import {
  persistCcrBlock,
  loadCcrBlock,
  touchCcrBlock,
  deleteCcrBlockRow,
  deleteAllCcrBlocks,
} from "./ccrBlocks.ts";

function row(principalId: string, hash: string, expiresAt: number) {
  return {
    principalId,
    hash,
    content: `content-${hash}`,
    bytes: 1,
    chars: 1,
    lines: 1,
    contentType: "text",
    source: "test",
    createdAt: 0,
    lastAccessedAt: 0,
    expiresAt,
  };
}

test("a persisted block is readable while unexpired", () => {
  const now = 1_000;
  persistCcrBlock({
    principalId: "p1",
    hash: "h1",
    content: "hello world",
    bytes: 11,
    chars: 11,
    lines: 1,
    contentType: "text",
    source: "test",
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + 1_000,
  });

  assert.equal(loadCcrBlock("p1", "h1", now)?.content, "hello world");
});

test("deleteCcrBlockRow removes one block, deleteAllCcrBlocks clears the store", () => {
  persistCcrBlock(row("p1", "a", 9_000));
  persistCcrBlock(row("p1", "b", 9_000));

  deleteCcrBlockRow("p1", "a");
  assert.equal(loadCcrBlock("p1", "a", 1_000), null);
  assert.equal(loadCcrBlock("p1", "b", 1_000)?.content, "content-b");

  deleteAllCcrBlocks();
  assert.equal(loadCcrBlock("p1", "b", 1_000), null);
});

test("touchCcrBlock updates lastAccessedAt", () => {
  persistCcrBlock(row("p1", "touched", 9_000));
  touchCcrBlock("p1", "touched", 4_242);
  assert.equal(loadCcrBlock("p1", "touched", 1_000)?.lastAccessedAt, 4_242);
});

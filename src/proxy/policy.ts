import {
  DEFAULT_CAVEMAN_CONFIG,
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_RTK_CONFIG,
  type CompressionConfig,
} from "../engine/types.ts";

export type AgentWire = "anthropic" | "openai-responses" | "openai-chat";

/** Which agent protocol an incoming request path speaks, or null when we should just proxy it. */
export function wireForPath(path: string): AgentWire | null {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  if (clean.endsWith("/v1/messages")) return "anthropic";
  if (clean.endsWith("/v1/responses")) return "openai-responses";
  if (clean.endsWith("/v1/chat/completions")) return "openai-chat";
  return null;
}

/**
 * Compression settings for coding agents (Claude Code, Codex).
 *
 * Deliberately RTK-only. Claude Code and Codex both rely on upstream prompt
 * caching, where a cache read costs a fraction of a fresh read. RTK is
 * deterministic per tool result, so re-compressing an older turn produces the
 * same bytes and the cached prefix still matches. Cross-turn engines
 * (session-dedup, relevance, ccr) rewrite earlier turns as history grows, which
 * changes the prefix on every request and forfeits the cache — usually costing
 * more than the compression saves. Caveman is off because mangling a developer's
 * own prose is a poor trade for a few percent.
 *
 * Override with TOKEN_SAVER_ENGINES=rtk,caveman if you want more.
 */
export function agentConfig(engineIds: string[] = ["rtk"]): CompressionConfig {
  const engines: Record<string, { enabled: boolean }> = {
    ...DEFAULT_COMPRESSION_CONFIG.engines,
  };
  for (const id of engineIds) engines[id] = { enabled: true };

  return {
    ...DEFAULT_COMPRESSION_CONFIG,
    enabled: true,
    defaultMode: "stacked",
    preserveSystemPrompt: true,
    preserveSystemPromptMode: "always",
    stackedPipeline: engineIds.map((engine) => ({ engine })),
    engines,
    rtkConfig: { ...DEFAULT_RTK_CONFIG, enabled: true, intensity: "aggressive" },
    cavemanConfig: { ...DEFAULT_CAVEMAN_CONFIG, enabled: engineIds.includes("caveman") },
  } as CompressionConfig;
}

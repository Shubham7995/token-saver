/**
 * token-saver — public API.
 *
 * Wraps OmniRoute's compression pipeline so any OpenAI-style request body can be
 * shrunk before it reaches a model (local or remote).
 */
import { applyCompressionAsync } from "./engine/strategySelector.ts";
import { registerBuiltinCompressionEngines } from "./engine/engines/index.ts";
import {
  DEFAULT_CAVEMAN_CONFIG,
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_RTK_CONFIG,
  type CompressionConfig,
  type CompressionMode,
  type CompressionResult,
} from "./engine/types.ts";
import type { StackedCompressionStep } from "./engine/strategySelector.ts";

let enginesRegistered = false;

function ensureEngines(): void {
  if (enginesRegistered) return;
  registerBuiltinCompressionEngines();
  enginesRegistered = true;
}

/**
 * The default stack from OmniRoute's docs: RTK (command/tool-output filtering)
 * followed by Caveman (filler-word removal on prose). Both engines must be
 * enabled in three places — the pipeline list, the `engines` map, and their own
 * config block — so this helper wires all three.
 */
export function defaultStackedConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
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
    ...overrides,
  };
}

export interface CompressOptions {
  /** Pipeline to run. Defaults to "stacked" (RTK then Caveman). */
  mode?: CompressionMode;
  /** Full engine configuration. Defaults to `defaultStackedConfig()`. */
  config?: CompressionConfig;
  /** Target model id — some engines (vision, tokenizer choice) key off it. */
  model?: string;
  /** Per-engine progress callback. */
  onEngineStep?: (step: StackedCompressionStep) => void;
}

/** Compresses an OpenAI-style chat-completions request body. */
export async function compress(
  body: Record<string, unknown>,
  options: CompressOptions = {}
): Promise<CompressionResult> {
  ensureEngines();
  const model = options.model ?? (typeof body.model === "string" ? body.model : undefined);
  return applyCompressionAsync(body, options.mode ?? "stacked", {
    model,
    config: options.config ?? defaultStackedConfig(),
    onEngineStep: options.onEngineStep,
  });
}

export { applyCompressionAsync, registerBuiltinCompressionEngines };
export { ENGINE_CATALOG } from "./engine/engineCatalog.ts";
export { listCompressionEngines, registerCompressionEngine } from "./engine/engines/registry.ts";
export type { CompressionConfig, CompressionMode, CompressionResult, StackedCompressionStep };

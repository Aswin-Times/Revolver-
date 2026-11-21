export interface TokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  /** Output tokens, thinking included. */
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: Readonly<TokenUsage> = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** USD per million tokens. Cache writes use the 5-minute TTL rate (1.25x input). */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Anthropic first-party prices (checked 2026-11). claude-sonnet-5 is here because it is
 * where Sonnet 5.5's server-side refusal fallback sends declined requests.
 */
export const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

/** Cost of a request in USD, or undefined if we have no price for the model. */
export function costUsd(model: string, usage: TokenUsage): number | undefined {
  const price = PRICING[model];
  if (!price) return undefined;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead) /
    1_000_000
  );
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

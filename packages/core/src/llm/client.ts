import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  BetaMessage,
  BetaMessageStreamParams as BetaStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { MessageCountTokensParams as CountTokensParams } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Effort } from "../config.js";
import type { TokenUsage } from "../cost.js";
import { LlmReviewSchema } from "./schema.js";

export interface LlmRequest {
  model: string;
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
}

export type LlmStopReason = "end_turn" | "max_tokens" | "refusal" | "other";

export interface LlmResponse {
  stopReason: LlmStopReason;
  /** Set on refusals, e.g. "cyber"; null when the refusal has no named category. */
  refusalCategory?: string | null;
  /** The text answer: JSON in our review schema when the request succeeded. */
  text: string;
  /** Model that produced the answer (differs from the request after a fallback). */
  servedBy: string;
  usage: TokenUsage;
}

/** What the review needs from Claude. Tests use fakes; production uses AnthropicLlmClient. */
export interface LlmClient {
  countTokens(request: LlmRequest): Promise<number>;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmUnavailableReason =
  "no-credentials" | "auth-failed" | "rate-limited" | "connection" | "api-error";

/** Claude couldn't be reached or refused our credentials; the review continues without it. */
export class LlmUnavailableError extends Error {
  override name = "LlmUnavailableError";
  constructor(
    message: string,
    readonly reason: LlmUnavailableReason,
  ) {
    super(message);
  }
}

/** The slice of the Anthropic SDK client we use, so tests can pass a stub. */
export interface AnthropicLike {
  beta: {
    messages: { stream(params: BetaStreamParams): { finalMessage(): Promise<BetaMessage> } };
  };
  messages: { countTokens(params: CountTokensParams): PromiseLike<{ input_tokens: number }> };
}

const REVIEW_FORMAT = zodOutputFormat(LlmReviewSchema);

export function buildMessageParams(request: LlmRequest): BetaStreamParams {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: request.user }],
    output_config: { effort: request.effort, format: REVIEW_FORMAT },
    // On a policy decline, the API re-runs the request on the recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
}

function stopReasonOf(reason: BetaMessage["stop_reason"]): LlmStopReason {
  return reason === "end_turn" || reason === "max_tokens" || reason === "refusal"
    ? reason
    : "other";
}

export function toLlmResponse(message: BetaMessage): LlmResponse {
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const stopReason = stopReasonOf(message.stop_reason);
  return {
    stopReason,
    ...(stopReason === "refusal"
      ? { refusalCategory: message.stop_details?.category ?? null }
      : {}),
    text,
    servedBy: message.model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

function toUnavailable(error: unknown): unknown {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmUnavailableError("Anthropic rejected the API key.", "auth-failed");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmUnavailableError("Rate limited by the Anthropic API.", "rate-limited");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmUnavailableError(
      `Couldn't reach the Anthropic API: ${error.message}`,
      "connection",
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmUnavailableError(
      `Anthropic API error ${error.status ?? ""}: ${error.message}`,
      "api-error",
    );
  }
  // The SDK throws a plain Error (no typed class) when it finds no credentials at all.
  if (
    error instanceof Error &&
    error.message.startsWith("Could not resolve authentication method")
  ) {
    return new LlmUnavailableError(
      "No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`).",
      "no-credentials",
    );
  }
  return error;
}

/**
 * Claude through the official SDK: structured output in our review schema, cached system
 * prompt, server-side refusal fallback, streaming (so large output budgets don't hit HTTP
 * timeouts) and the SDK's own retries for 429/5xx/connection errors.
 */
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly sdk: AnthropicLike = new Anthropic({ maxRetries: 2, timeout: 5 * 60_000 }),
  ) {}

  async countTokens(request: LlmRequest): Promise<number> {
    try {
      const params = buildMessageParams(request);
      const counted = await this.sdk.messages.countTokens({
        model: params.model,
        system: [{ type: "text", text: request.system }],
        messages: [{ role: "user", content: request.user }],
        output_config: { format: REVIEW_FORMAT },
      });
      return counted.input_tokens;
    } catch (error) {
      throw toUnavailable(error);
    }
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const message = await this.sdk.beta.messages
        .stream(buildMessageParams(request))
        .finalMessage();
      return toLlmResponse(message);
    } catch (error) {
      throw toUnavailable(error);
    }
  }
}

/** The production client. Pass apiKey when it comes from somewhere other than process.env. */
export function createAnthropicLlmClient(options: { apiKey?: string } = {}): AnthropicLlmClient {
  return new AnthropicLlmClient(
    new Anthropic({
      maxRetries: 2,
      timeout: 5 * 60_000,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    }),
  );
}

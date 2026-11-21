import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  AnthropicLlmClient,
  buildMessageParams,
  LlmUnavailableError,
  toLlmResponse,
  type AnthropicLike,
  type LlmRequest,
} from "../../src/llm/client.js";

const request: LlmRequest = {
  model: "claude-sonnet-5-5",
  effort: "medium",
  maxTokens: 16_000,
  system: "SYSTEM",
  user: "USER",
};

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const message = (overrides: Record<string, unknown> = {}): BetaMessage =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: '{"summary":"ok",' },
      { type: "text", text: '"staticVerdicts":[],"findings":[]}' },
    ],
    stop_reason: "end_turn",
    stop_details: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 800,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: null,
    },
    ...overrides,
  }) as unknown as BetaMessage;

/** Walks a JSON schema and returns every object schema in it. */
function objectSchemas(schema: unknown): Record<string, unknown>[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const children = Object.values(node).flatMap((v) =>
    Array.isArray(v) ? v.flatMap(objectSchemas) : objectSchemas(v),
  );
  return node.type === "object" ? [node, ...children] : children;
}

describe("buildMessageParams", () => {
  const params = buildMessageParams(request);

  it("sends the model, output budget, cached system prompt and one user message", () => {
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: [{ type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "USER" }],
    });
  });

  it("asks for structured output in our review schema at the configured effort", () => {
    expect(params.output_config?.effort).toBe("medium");
    expect(params.output_config?.format?.type).toBe("json_schema");
    const schema = params.output_config?.format?.schema as { properties: object };
    expect(Object.keys(schema.properties)).toEqual(["summary", "staticVerdicts", "findings"]);
  });

  it("produces a schema structured outputs accepts: closed objects, every field required", () => {
    const schema = params.output_config?.format?.schema;
    for (const node of objectSchemas(schema)) {
      expect(node.additionalProperties).toBe(false);
      expect([...((node.required as string[]) ?? [])].sort()).toEqual(
        Object.keys(node.properties as object).sort(),
      );
    }
  });

  it("opts into server-side refusal fallback", () => {
    expect(params.betas).toContain("server-side-fallback-2026-07-01");
    expect(params.fallbacks).toBe("default");
  });
});

describe("toLlmResponse", () => {
  it("joins the text blocks, skipping thinking, and maps usage", () => {
    expect(toLlmResponse(message())).toEqual({
      stopReason: "end_turn",
      text: '{"summary":"ok","staticVerdicts":[],"findings":[]}',
      servedBy: "claude-sonnet-5-5",
      usage: { inputTokens: 1200, outputTokens: 800, cacheReadTokens: 3000, cacheWriteTokens: 0 },
    });
  });

  it("reports a refusal with its category, and which model served the request", () => {
    const response = toLlmResponse(
      message({
        model: "claude-sonnet-5",
        content: [],
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: "cyber", explanation: null },
      }),
    );
    expect(response).toMatchObject({
      stopReason: "refusal",
      refusalCategory: "cyber",
      servedBy: "claude-sonnet-5",
    });
  });

  it("maps a cut-off answer to max_tokens and anything unexpected to other", () => {
    expect(toLlmResponse(message({ stop_reason: "max_tokens" })).stopReason).toBe("max_tokens");
    expect(toLlmResponse(message({ stop_reason: "pause_turn" })).stopReason).toBe("other");
  });
});

function stub(behaviour: {
  final?: BetaMessage;
  tokens?: number;
  error?: Error;
}): AnthropicLike & { streamed: unknown[]; counted: unknown[] } {
  const streamed: unknown[] = [];
  const counted: unknown[] = [];
  return {
    streamed,
    counted,
    beta: {
      messages: {
        stream(params) {
          streamed.push(params);
          return {
            finalMessage: () =>
              behaviour.error
                ? Promise.reject(behaviour.error)
                : Promise.resolve(behaviour.final ?? message()),
          };
        },
      },
    },
    messages: {
      countTokens(params) {
        counted.push(params);
        return behaviour.error
          ? Promise.reject(behaviour.error)
          : Promise.resolve({ input_tokens: behaviour.tokens ?? 0 });
      },
    },
  };
}

describe("AnthropicLlmClient", () => {
  it("streams the request and returns the mapped final message", async () => {
    const sdk = stub({});
    const response = await new AnthropicLlmClient(sdk).complete(request);
    expect(sdk.streamed).toEqual([buildMessageParams(request)]);
    expect(response.stopReason).toBe("end_turn");
  });

  it("counts tokens for the same system prompt, message and output format", async () => {
    const sdk = stub({ tokens: 4321 });
    expect(await new AnthropicLlmClient(sdk).countTokens(request)).toBe(4321);
    expect(sdk.counted[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "USER" }],
      output_config: { format: { type: "json_schema" } },
    });
  });

  it.each([
    [
      "no credentials",
      new Error("Could not resolve authentication method. Expected one of apiKey, authToken, ..."),
      "no-credentials",
    ],
    [
      "a rejected key",
      new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()),
      "auth-failed",
    ],
    [
      "rate limiting",
      new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()),
      "rate-limited",
    ],
    [
      "a network failure",
      new Anthropic.APIConnectionError({ message: "socket hang up" }),
      "connection",
    ],
    [
      "a server error",
      new Anthropic.InternalServerError(500, undefined, "oops", new Headers()),
      "api-error",
    ],
  ])("turns %s into LlmUnavailableError(%s)", async (_case, error, reason) => {
    const client = new AnthropicLlmClient(stub({ error }));
    await expect(client.complete(request)).rejects.toMatchObject({
      name: "LlmUnavailableError",
      reason,
    });
    await expect(client.countTokens(request)).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

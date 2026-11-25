import type { LlmClient, LlmRequest, LlmResponse } from "../../src/llm/client.js";
import type { LlmReview } from "../../src/llm/schema.js";
import type { CommandRunner } from "../../src/static/exec.js";

export const cleanPromptScan: CommandRunner = (command, args) => {
  if (command !== "gitleaks" || args[0] !== "stdin") {
    return Promise.reject(new Error("unexpected scanner command"));
  }
  return Promise.resolve({
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    truncated: false,
  });
};

export const usage = (input = 1000, output = 500) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export const answer = (review: LlmReview, overrides: Partial<LlmResponse> = {}): LlmResponse => ({
  stopReason: "end_turn",
  text: JSON.stringify(review),
  servedBy: "claude-sonnet-5-5",
  usage: usage(),
  ...overrides,
});

export const emptyReview = (): LlmReview => ({
  summary: "Looks good!",
  staticVerdicts: [],
  findings: [],
});

/** A scripted LlmClient: answers in order, records every request it gets. */
export function fakeLlm(options: {
  responses?: (LlmResponse | Error)[];
  tokens?: (request: LlmRequest) => number;
}): LlmClient & { requests: LlmRequest[]; counted: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const counted: LlmRequest[] = [];
  const queue = [...(options.responses ?? [])];
  return {
    requests,
    counted,
    countTokens(request) {
      counted.push(request);
      return Promise.resolve(options.tokens ? options.tokens(request) : 1000);
    },
    complete(request) {
      requests.push(request);
      const next = queue.shift();
      if (!next) return Promise.reject(new Error("fakeLlm: no more scripted responses"));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

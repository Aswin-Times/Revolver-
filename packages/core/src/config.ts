import { z } from "zod";

export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

export const ReviewConfigSchema = z.object({
  /** Claude model for the LLM pass. */
  model: z.string().min(1),
  /** How hard Claude thinks. Higher is slower and costs more output tokens. */
  effort: EffortSchema,
  /** At most this many comments per review, so students aren't overwhelmed. */
  maxComments: z.number().int().positive().max(100),
  /** Findings below this confidence are dropped. */
  minConfidence: z.number().min(0).max(1),
  budget: z.object({
    /** Per-PR cap on prompt tokens sent to Claude. */
    maxInputTokens: z.number().int().positive(),
    /** Per-request cap on output tokens (thinking + the JSON answer). */
    maxOutputTokens: z.number().int().min(1024),
  }),
});
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;

export interface ConfigOverrides {
  model?: string;
  effort?: Effort;
  maxComments?: number;
  minConfidence?: number;
  budget?: Partial<ReviewConfig["budget"]>;
}

export const DEFAULT_CONFIG: Readonly<ReviewConfig> = {
  model: "claude-sonnet-5-5",
  effort: "medium",
  maxComments: 15,
  minConfidence: 0.5,
  budget: { maxInputTokens: 80_000, maxOutputTokens: 16_000 },
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Config field path → environment variable that sets it. */
const ENV_VARS = {
  model: "PR_MENTOR_MODEL",
  effort: "PR_MENTOR_EFFORT",
  maxComments: "PR_MENTOR_MAX_COMMENTS",
  minConfidence: "PR_MENTOR_MIN_CONFIDENCE",
  "budget.maxInputTokens": "PR_MENTOR_MAX_INPUT_TOKENS",
  "budget.maxOutputTokens": "PR_MENTOR_MAX_OUTPUT_TOKENS",
} as const;

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function readNumber(env: Env, name: string): number | undefined {
  const value = read(env, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new ConfigError(`${name} must be a number, got "${value}"`);
  return parsed;
}

const definedOnly = <T extends object>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Build the review config: explicit overrides > PR_MENTOR_* env vars > defaults. */
export function loadConfig(env: Env = process.env, overrides: ConfigOverrides = {}): ReviewConfig {
  const fromEnv = definedOnly({
    model: read(env, ENV_VARS.model),
    effort: read(env, ENV_VARS.effort),
    maxComments: readNumber(env, ENV_VARS.maxComments),
    minConfidence: readNumber(env, ENV_VARS.minConfidence),
  });
  const budgetFromEnv = definedOnly({
    maxInputTokens: readNumber(env, ENV_VARS["budget.maxInputTokens"]),
    maxOutputTokens: readNumber(env, ENV_VARS["budget.maxOutputTokens"]),
  });

  const candidate = {
    ...DEFAULT_CONFIG,
    ...fromEnv,
    ...definedOnly({ ...overrides, budget: undefined }),
    budget: { ...DEFAULT_CONFIG.budget, ...budgetFromEnv, ...definedOnly(overrides.budget ?? {}) },
  };

  const parsed = ReviewConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    const name = (ENV_VARS as Record<string, string>)[path] ?? path;
    throw new ConfigError(`Invalid ${name}: ${issue?.message ?? "bad value"}`);
  }
  return parsed.data;
}

import {
  createAnthropicLlmClient,
  reviewDiff,
  type Finding,
  type LlmClient,
  type ReviewConfig,
  type ReviewResult,
  type StaticPassOptions,
} from "@pr-mentor/core";
import type { EvalCase } from "./case.js";
import { scoreCase, type CaseScore } from "./match.js";

/**
 * static: tools + missing-tests check (free, deterministic). full: adds Claude.
 * oracle / null: harness self-checks that feed the expected answers / nothing.
 */
export type Mode = "static" | "full" | "oracle" | "null";

export type ReviewFn = typeof reviewDiff;

export interface RunOptions {
  mode: Mode;
  config: ReviewConfig;
  reps: number;
  /** Stop starting new cases once Claude spend reaches this. */
  maxCostUsd: number;
  createLlm?: () => LlmClient;
  staticOptions?: StaticPassOptions;
  /** Tests inject a fake; defaults to the real reviewDiff (same entry point as the CLI). */
  review?: ReviewFn;
}

export interface ResultRow {
  caseId: string;
  rep: number;
  mode: Mode;
  status: ReviewResult["status"] | "oracle" | "null";
  findings: Finding[];
  score: CaseScore;
  llm?: Pick<ReviewResult["llm"], "status" | "servedBy" | "usage" | "costUsd" | "detail">;
  durationMs: number;
}

export interface ErrorRow {
  caseId: string;
  rep: number;
  kind: "llm-failed" | "wrong-model" | "harness-error";
  detail: string;
}

export interface RunOutput {
  mode: Mode;
  results: ResultRow[];
  errors: ErrorRow[];
  refusals: number;
  costUsd: number;
  stoppedByCostCap: boolean;
}

const oracleFindings = (c: EvalCase): Finding[] =>
  c.meta.expected.map((e) => ({
    file: e.file,
    line: e.lines[0],
    ...(e.lines[1] > e.lines[0] ? { endLine: e.lines[1] } : {}),
    category: e.category,
    severity: "medium",
    title: e.why,
    explanation: e.why,
    suggestion: "-",
    references: [],
    confidence: 1,
    source: "llm",
  }));

/**
 * Run every case (times reps in full mode) through the real review entry point and score
 * what students would see. Anything that never produced a scorable answer goes to
 * `errors` rather than being scored as a miss.
 */
export async function runEval(cases: EvalCase[], options: RunOptions): Promise<RunOutput> {
  const out: RunOutput = {
    mode: options.mode,
    results: [],
    errors: [],
    refusals: 0,
    costUsd: 0,
    stoppedByCostCap: false,
  };
  const reps = options.mode === "full" ? options.reps : 1;
  const review = options.review ?? reviewDiff;
  const llm =
    options.mode === "full" ? (options.createLlm ?? (() => createAnthropicLlmClient()))() : null;

  for (const c of cases) {
    for (let rep = 1; rep <= reps; rep++) {
      if (out.costUsd >= options.maxCostUsd) {
        out.stoppedByCostCap = true;
        return out;
      }
      const started = Date.now();

      if (options.mode === "oracle" || options.mode === "null") {
        const findings = options.mode === "oracle" ? oracleFindings(c) : [];
        out.results.push({
          caseId: c.id,
          rep,
          mode: options.mode,
          status: options.mode,
          findings,
          score: scoreCase(c.id, c.meta, findings),
          durationMs: 0,
        });
        continue;
      }

      let result: ReviewResult;
      try {
        result = await review(c.diff, c.repo, {
          config: options.config,
          llm,
          ...(options.staticOptions ? { static: options.staticOptions } : {}),
        });
      } catch (error) {
        out.errors.push({
          caseId: c.id,
          rep,
          kind: "harness-error",
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const { status, servedBy, usage, costUsd, detail } = result.llm;
      out.costUsd += costUsd ?? 0;
      if (options.mode === "full" && (status === "failed" || status === "skipped")) {
        out.errors.push({ caseId: c.id, rep, kind: "llm-failed", detail: detail ?? status });
        continue;
      }
      if (options.mode === "full" && status === "ran" && servedBy !== options.config.model) {
        out.errors.push({
          caseId: c.id,
          rep,
          kind: "wrong-model",
          detail: `asked for ${options.config.model}, served by ${servedBy ?? "unknown"}`,
        });
        continue;
      }
      if (status === "declined") out.refusals++;

      out.results.push({
        caseId: c.id,
        rep,
        mode: options.mode,
        status: result.status,
        findings: result.findings,
        score: scoreCase(c.id, c.meta, result.findings),
        llm: {
          status,
          ...(servedBy ? { servedBy } : {}),
          usage,
          ...(costUsd === undefined ? {} : { costUsd }),
          ...(detail ? { detail } : {}),
        },
        durationMs: Date.now() - started,
      });
    }
  }
  return out;
}

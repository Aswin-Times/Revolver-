import type { Category } from "@pr-mentor/core";
import type { CaseScore } from "./match.js";

export const CATEGORIES: Category[] = ["security", "tests", "quality"];

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  /** Undefined when nothing was reported: no answer is not the same as a wrong answer. */
  precision?: number;
  /** Undefined when nothing was expected. */
  recall?: number;
  f1?: number;
}

export interface Metrics {
  byCategory: Record<Category, Counts>;
  overall: Counts;
  /** How many clean PRs got zero findings, and how many findings clean PRs got in total. */
  clean: { cases: number; zeroFindings: number; findings: number };
}

function finish(tp: number, fp: number, fn: number): Counts {
  const precision = tp + fp === 0 ? undefined : tp / (tp + fp);
  const recall = tp + fn === 0 ? undefined : tp / (tp + fn);
  const f1 =
    precision === undefined || recall === undefined || precision + recall === 0
      ? undefined
      : (2 * precision * recall) / (precision + recall);
  return {
    tp,
    fp,
    fn,
    ...(precision === undefined ? {} : { precision }),
    ...(recall === undefined ? {} : { recall }),
    ...(f1 === undefined ? {} : { f1 }),
  };
}

export function computeMetrics(scores: CaseScore[]): Metrics {
  const raw = Object.fromEntries(CATEGORIES.map((c) => [c, { tp: 0, fp: 0, fn: 0 }])) as Record<
    Category,
    { tp: number; fp: number; fn: number }
  >;
  for (const s of scores) {
    for (const m of s.tp) raw[m.expected.category].tp++;
    for (const f of s.fp) raw[f.category].fp++;
    for (const e of s.fn) raw[e.category].fn++;
  }
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [c, finish(raw[c].tp, raw[c].fp, raw[c].fn)]),
  ) as Record<Category, Counts>;
  const sum = (k: "tp" | "fp" | "fn") => CATEGORIES.reduce((n, c) => n + raw[c][k], 0);

  const clean = scores.filter((s) => s.clean);
  return {
    byCategory,
    overall: finish(sum("tp"), sum("fp"), sum("fn")),
    clean: {
      cases: clean.length,
      zeroFindings: clean.filter((s) => s.fp.length + s.allowed.length === 0).length,
      findings: clean.reduce((n, s) => n + s.fp.length + s.allowed.length, 0),
    },
  };
}

export interface Aggregate {
  n: number;
  mean?: number;
  /** Sample standard deviation; undefined with fewer than two values. */
  stdev?: number;
}

export function aggregate(values: (number | undefined)[]): Aggregate {
  const xs = values.filter((v): v is number => v !== undefined);
  if (xs.length === 0) return { n: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (xs.length < 2) return { n: xs.length, mean };
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return { n: xs.length, mean, stdev: Math.sqrt(variance) };
}

export type RepSummary = Record<
  Category | "overall",
  { precision: Aggregate; recall: Aggregate; f1: Aggregate }
>;

/** Mean and spread of each metric across repeated runs. */
export function summarizeReps(reps: Metrics[]): RepSummary {
  const pick = (counts: Counts[]) => ({
    precision: aggregate(counts.map((c) => c.precision)),
    recall: aggregate(counts.map((c) => c.recall)),
    f1: aggregate(counts.map((c) => c.f1)),
  });
  const out = Object.fromEntries(
    CATEGORIES.map((c) => [c, pick(reps.map((r) => r.byCategory[c]))]),
  ) as RepSummary;
  out.overall = pick(reps.map((r) => r.overall));
  return out;
}

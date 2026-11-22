import type { Category } from "@pr-mentor/core";
import {
  CATEGORIES,
  computeMetrics,
  summarizeReps,
  type Counts,
  type Metrics,
  type RepSummary,
} from "./metrics.js";
import type { ErrorRow, Mode, RunOutput } from "./run.js";

export interface CaseLine {
  caseId: string;
  tp: number;
  fp: number;
  fn: number;
  notes: string[];
}

export interface EvalReport {
  mode: Mode;
  cases: number;
  reps: number;
  /** Pooled over every scored (case, rep). */
  metrics: Metrics;
  /** Mean ± spread across reps (meaningful when reps > 1). */
  perRep: RepSummary;
  perCase: CaseLine[];
  errors: ErrorRow[];
  refusals: number;
  costUsd: number;
  stoppedByCostCap: boolean;
}

export type Thresholds = Partial<
  Record<Category | "overall", { precision?: number; recall?: number }>
> & {
  cleanZeroFindings?: number;
};

const pct = (x: number | undefined) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function buildReport(out: RunOutput, caseCount: number): EvalReport {
  const reps = Math.max(1, ...out.results.map((r) => r.rep));
  const perRep = summarizeReps(
    Array.from({ length: reps }, (_, i) =>
      computeMetrics(out.results.filter((r) => r.rep === i + 1).map((r) => r.score)),
    ),
  );

  const byCase = new Map<string, CaseLine>();
  for (const r of out.results) {
    const line = byCase.get(r.caseId) ?? { caseId: r.caseId, tp: 0, fp: 0, fn: 0, notes: [] };
    line.tp += r.score.tp.length;
    line.fp += r.score.fp.length;
    line.fn += r.score.fn.length;
    for (const f of r.score.fp) {
      line.notes.push(
        `FP: ${f.category} \`${f.file}:${f.line}\`${f.ruleId ? ` (${f.ruleId})` : ` (${f.source})`}`,
      );
    }
    for (const e of r.score.fn)
      line.notes.push(`missed: ${e.category} \`${e.file}:${e.lines[0]}\``);
    byCase.set(r.caseId, line);
  }

  return {
    mode: out.mode,
    cases: caseCount,
    reps,
    metrics: computeMetrics(out.results.map((r) => r.score)),
    perRep,
    perCase: [...byCase.values()].sort((a, b) => (a.caseId < b.caseId ? -1 : 1)),
    errors: out.errors,
    refusals: out.refusals,
    costUsd: out.costUsd,
    stoppedByCostCap: out.stoppedByCostCap,
  };
}

function delta(now: number | undefined, before: number | undefined): string {
  if (now === undefined || before === undefined) return `${pct(before)} → ${pct(now)}`;
  const d = Math.round((now - before) * 100);
  const sign = d === 0 ? "±0" : d > 0 ? `+${d}` : `−${-d}`;
  return `${pct(before)} → ${pct(now)} (${sign})`;
}

const row = (name: string, c: Counts) =>
  `| ${name} | ${pct(c.precision)} | ${pct(c.recall)} | ${pct(c.f1)} | ${c.tp} | ${c.fp} | ${c.fn} |`;

const spread = (a: { mean?: number; stdev?: number }) =>
  a.mean === undefined ? "–" : `${pct(a.mean)} ± ${Math.round((a.stdev ?? 0) * 100)}`;

/** Markdown report. Deliberately free of timestamps so a committed baseline is stable. */
export function renderReport(report: EvalReport, previous?: EvalReport): string {
  const m = report.metrics;
  const lines = [
    `# PR Mentor eval: ${report.mode} mode`,
    "",
    `${plural(report.cases, "case")} · ${plural(report.reps, "rep")} · ${plural(report.errors.length, "error")} · ${plural(report.refusals, "refusal")} · Claude cost $${report.costUsd.toFixed(4)}`,
    ...(report.stoppedByCostCap ? ["", "**Stopped early: the cost cap was reached.**"] : []),
    "",
    "| Category | Precision | Recall | F1 | TP | FP | FN |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...CATEGORIES.map((c) => row(c, m.byCategory[c])),
    row("**overall**", m.overall),
    "",
    `Clean PRs: ${m.clean.zeroFindings}/${m.clean.cases} with zero findings (${plural(m.clean.findings, "finding")} on clean PRs in total)`,
  ];

  if (report.reps > 1) {
    lines.push(
      "",
      "## Across reps (mean ± standard deviation, points)",
      "",
      "| Category | Precision | Recall | F1 |",
      "| --- | --- | --- | --- |",
      ...[...CATEGORIES, "overall" as const].map(
        (c) =>
          `| ${c} | ${spread(report.perRep[c].precision)} | ${spread(report.perRep[c].recall)} | ${spread(report.perRep[c].f1)} |`,
      ),
    );
  }

  if (previous) {
    const p = previous.metrics;
    lines.push(
      "",
      "## Compared with the previous run",
      "",
      "| Category | Precision | Recall | F1 |",
      "| --- | --- | --- | --- |",
      ...[...CATEGORIES, "overall" as const].map((c) => {
        const now = c === "overall" ? m.overall : m.byCategory[c];
        const before = c === "overall" ? p.overall : p.byCategory[c];
        return `| ${c} | ${delta(now.precision, before.precision)} | ${delta(now.recall, before.recall)} | ${delta(now.f1, before.f1)} |`;
      }),
    );
  }

  lines.push(
    "",
    "## Per case",
    "",
    "| Case | TP | FP | FN | Notes |",
    "| --- | --- | --- | --- | --- |",
    ...report.perCase.map(
      (c) => `| ${c.caseId} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.notes.join("; ")} |`,
    ),
  );

  if (report.errors.length > 0) {
    lines.push(
      "",
      "## Errors (not scored)",
      "",
      "| Case | Rep | Kind | Detail |",
      "| --- | --- | --- | --- |",
      ...report.errors.map(
        (e) => `| ${e.caseId} | ${e.rep} | ${e.kind} | ${e.detail.replace(/\|/g, "\\|")} |`,
      ),
    );
  }
  return lines.join("\n") + "\n";
}

/** Human-readable list of every metric below its threshold; empty when all pass. */
export function checkThresholds(report: EvalReport, thresholds: Thresholds): string[] {
  const failures: string[] = [];
  for (const key of [...CATEGORIES, "overall" as const]) {
    const limits = thresholds[key];
    if (!limits) continue;
    const counts = key === "overall" ? report.metrics.overall : report.metrics.byCategory[key];
    for (const metric of ["precision", "recall"] as const) {
      const min = limits[metric];
      if (min === undefined) continue;
      const value = counts[metric];
      if (value === undefined || value < min) {
        failures.push(`${key} ${metric} ${pct(value)} is below ${pct(min)}`);
      }
    }
  }
  if (
    thresholds.cleanZeroFindings !== undefined &&
    report.metrics.clean.zeroFindings < thresholds.cleanZeroFindings
  ) {
    failures.push(
      `only ${report.metrics.clean.zeroFindings} clean PRs stayed clean, need ${thresholds.cleanZeroFindings}`,
    );
  }
  return failures;
}

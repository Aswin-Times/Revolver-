import type { Category, Finding, Severity, Source } from "../finding.js";

const SEVERITY: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY: Record<Category, number> = { security: 0, tests: 1, quality: 2 };
/** When two findings say the same thing, prefer the more precise source. */
const SOURCE: Record<Source, number> = { gitleaks: 0, semgrep: 1, lint: 2, heuristic: 3, llm: 4 };

const end = (f: Finding) => f.endLine ?? f.line;
const overlaps = (a: Finding, b: Finding) =>
  a.file === b.file && a.category === b.category && a.line <= end(b) && b.line <= end(a);

/** Best first: for choosing which duplicate to keep. */
const byQuality = (a: Finding, b: Finding) =>
  SEVERITY[a.severity] - SEVERITY[b.severity] ||
  b.confidence - a.confidence ||
  SOURCE[a.source] - SOURCE[b.source];

/** The order students see: severity, then security > tests > quality, then confidence. */
const byRank = (a: Finding, b: Finding) =>
  SEVERITY[a.severity] - SEVERITY[b.severity] ||
  CATEGORY[a.category] - CATEGORY[b.category] ||
  b.confidence - a.confidence ||
  (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

export interface RankOptions {
  maxComments: number;
  minConfidence: number;
}

/**
 * Drop low-confidence findings, collapse overlapping duplicates (same file, category and
 * lines) into the best one, sort, and split into what's shown and what's held back so
 * students aren't overwhelmed.
 */
export function rankFindings(
  findings: Finding[],
  options: RankOptions,
): { shown: Finding[]; hidden: Finding[] } {
  const kept: Finding[] = [];
  for (const finding of findings
    .filter((f) => f.confidence >= options.minConfidence)
    .sort(byQuality)) {
    if (!kept.some((k) => overlaps(k, finding))) kept.push(finding);
  }
  const ranked = kept.sort(byRank);
  return { shown: ranked.slice(0, options.maxComments), hidden: ranked.slice(options.maxComments) };
}

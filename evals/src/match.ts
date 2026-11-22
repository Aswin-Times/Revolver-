import type { Finding } from "@pr-mentor/core";
import type { CaseMeta, Expected } from "./case.js";

/** How far outside the expected line range a finding may point and still count. */
export const LINE_TOLERANCE = 2;

export interface Match {
  expected: Expected;
  found: Finding;
}

export interface CaseScore {
  caseId: string;
  clean: boolean;
  tp: Match[];
  /** Findings that matched nothing expected or allowed. */
  fp: Finding[];
  /** Expected findings nobody reported. */
  fn: Expected[];
  /** Findings that matched an "allowed" entry: counted neither way. */
  allowed: Finding[];
}

const end = (f: Finding) => f.endLine ?? f.line;

/** Distance from a finding's lines to a range, 0 when they overlap. */
function distance(f: Finding, [start, stop]: [number, number]): number {
  if (end(f) < start) return start - end(f);
  if (f.line > stop) return f.line - stop;
  return 0;
}

/**
 * Score one case: each expected finding is claimed by at most one reported finding (same
 * file and category, lines within LINE_TOLERANCE of the range, closest wins). Leftovers
 * are allowed extras or false positives; a second report of the same issue is a false
 * positive, because the student sees it twice.
 */
export function scoreCase(caseId: string, meta: CaseMeta, findings: Finding[]): CaseScore {
  const unmatched = [...findings];
  const tp: Match[] = [];
  const fn: Expected[] = [];

  for (const expected of meta.expected) {
    let best = -1;
    let bestDistance = Infinity;
    unmatched.forEach((f, i) => {
      if (f.file !== expected.file || f.category !== expected.category) return;
      const d = distance(f, expected.lines);
      if (d <= LINE_TOLERANCE && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    if (best === -1) fn.push(expected);
    else tp.push({ expected, found: unmatched.splice(best, 1)[0] as Finding });
  }

  const allowed: Finding[] = [];
  const fp: Finding[] = [];
  for (const f of unmatched) {
    const ok = meta.allowed.some(
      (a) =>
        a.file === f.file &&
        a.category === f.category &&
        (!a.lines || distance(f, a.lines) <= LINE_TOLERANCE),
    );
    (ok ? allowed : fp).push(f);
  }
  return { caseId, clean: meta.clean, tp, fp, fn, allowed };
}

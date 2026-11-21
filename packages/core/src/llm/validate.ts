import type { FileDiff } from "../diff/types.js";
import { FindingSchema, type Finding, type Severity } from "../finding.js";
import { sanitizePlain, sanitizeReferences, sanitizeText } from "../sanitize.js";
import type { LlmFinding, LlmReview } from "./schema.js";

const MAX = { title: 120, explanation: 1500, suggestion: 2500, why: 300, summary: 600 };
/** LLM-only findings rank below tool findings Claude confirmed. */
const MAX_LLM_CONFIDENCE = 0.9;

export interface ValidVerdict {
  id: string;
  verdict: "confirm" | "reject";
  why: string;
  severity?: Severity;
  explanation?: string;
  suggestion?: string;
}

export interface DroppedFinding {
  title: string;
  reason: "unknown-file" | "line-not-in-diff" | "invalid";
}

export interface ValidatedReview {
  summary: string;
  verdicts: ValidVerdict[];
  findings: Finding[];
  dropped: DroppedFinding[];
}

/** New-side lines each file's diff shows (added or context): the only lines we accept. */
function visibleLines(files: FileDiff[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) if (line.kind !== "del") lines.add(line.newLine);
    }
    map.set(file.path, lines);
  }
  return map;
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

function toFinding(item: LlmFinding, visible: Set<number>): Finding | undefined {
  const candidate: Finding = {
    file: item.file,
    line: item.line,
    ...(item.endLine !== null && item.endLine > item.line && visible.has(item.endLine)
      ? { endLine: item.endLine }
      : {}),
    category: item.category,
    severity: item.severity,
    title: sanitizePlain(item.title, MAX.title),
    explanation: sanitizeText(item.explanation, MAX.explanation),
    suggestion: sanitizeText(item.suggestion, MAX.suggestion),
    references: sanitizeReferences(item.references),
    confidence: clamp(item.confidence, 0, MAX_LLM_CONFIDENCE),
    source: "llm",
  };
  return FindingSchema.safeParse(candidate).success ? candidate : undefined;
}

/**
 * Turn Claude's schema-valid answer into something safe to use: findings must point at a
 * file and line the diff actually shows (anything else is hallucinated or injected),
 * links must be on allowed sites, text is sanitized, and verdicts must name a known
 * static finding.
 */
export function validateLlmReview(
  review: LlmReview,
  files: FileDiff[],
  staticIds: Iterable<string>,
): ValidatedReview {
  const visible = visibleLines(files);
  const findings: Finding[] = [];
  const dropped: DroppedFinding[] = [];

  for (const item of review.findings) {
    const title = sanitizePlain(item.title, MAX.title) || "(untitled)";
    const lines = visible.get(item.file);
    if (!lines) {
      dropped.push({ title, reason: "unknown-file" });
      continue;
    }
    if (!lines.has(item.line)) {
      dropped.push({ title, reason: "line-not-in-diff" });
      continue;
    }
    const finding = toFinding(item, lines);
    if (finding) findings.push(finding);
    else dropped.push({ title, reason: "invalid" });
  }

  const known = new Set(staticIds);
  const seen = new Set<string>();
  const verdicts: ValidVerdict[] = [];
  for (const v of review.staticVerdicts) {
    if (!known.has(v.id) || seen.has(v.id)) continue;
    seen.add(v.id);
    const explanation = v.explanation ? sanitizeText(v.explanation, MAX.explanation) : "";
    const suggestion = v.suggestion ? sanitizeText(v.suggestion, MAX.suggestion) : "";
    verdicts.push({
      id: v.id,
      verdict: v.verdict,
      why: sanitizePlain(v.why, MAX.why),
      ...(v.severity ? { severity: v.severity } : {}),
      ...(explanation ? { explanation } : {}),
      ...(suggestion ? { suggestion } : {}),
    });
  }

  return { summary: sanitizeText(review.summary, MAX.summary), verdicts, findings, dropped };
}

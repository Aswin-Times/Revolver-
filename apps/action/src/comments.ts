import { redactSecretPatterns, renderFinding, type Finding } from "@pr-mentor/core";
import { marker, SUMMARY_MARKER } from "./fingerprint.js";

export interface InlineComment {
  path: string;
  line: number;
  /** First line of a multi-line comment (same hunk as `line`). */
  startLine?: number;
  side: "RIGHT";
  body: string;
}

/**
 * One inline review comment. Findings are already redacted and sanitized; secrets are
 * scrubbed once more here because this is the last step before text leaves the runner.
 */
export function inlineBody(finding: Finding, fp: string): string {
  const rendered = renderFinding(finding).replace(/^## /, "### ");
  return `${redactSecretPatterns(rendered)}\n\n<sub>PR Mentor</sub>\n\n${marker(fp)}`;
}

/** The single summary comment, edited in place on every push. */
export function summaryBody(
  report: string,
  counts: { posted: number; alreadyPosted: number },
): string {
  const plural = counts.posted === 1 ? "" : "s";
  const note = `_${counts.posted} new inline comment${plural} on this push (${counts.alreadyPosted} already posted earlier)._`;
  return `${redactSecretPatterns(report.trimEnd())}\n\n${note}\n\n${SUMMARY_MARKER}`;
}

import { createHash } from "node:crypto";
import type { Finding } from "@pr-mentor/core";

/**
 * A stable id for "this issue in this code", so a new push doesn't re-post comments.
 * It uses the flagged line's text, not its number (code moves when lines are added above),
 * and for Claude's findings the category instead of the title (titles vary between runs).
 */
export function fingerprint(finding: Finding, lineText: string): string {
  const what = finding.ruleId ?? `${finding.source}:${finding.category}`;
  const code = lineText.trim().replace(/\s+/g, " ");
  return createHash("sha256")
    .update([finding.file, finding.category, what, code].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

const FP = /<!-- pr-mentor:fp=([0-9a-f]{16}) -->/;

export const marker = (fp: string) => `<!-- pr-mentor:fp=${fp} -->`;
export const readFingerprint = (body: string) => FP.exec(body)?.[1];

export const SUMMARY_MARKER = "<!-- pr-mentor:summary -->";
export const isSummary = (body: string) => body.includes(SUMMARY_MARKER);

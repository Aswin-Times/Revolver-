import type { FileDiff, Finding, Hunk } from "@pr-mentor/core";
import { inlineBody, type InlineComment } from "./comments.js";
import { fingerprint, readFingerprint } from "./fingerprint.js";

export interface PlanInput {
  findings: Finding[];
  files: FileDiff[];
  /** Bodies of review comments already on the PR. */
  existingBodies: string[];
}

export interface ReviewPlan {
  post: InlineComment[];
  alreadyPosted: number;
}

const visible = (hunk: Hunk, line: number) =>
  hunk.lines.find((l) => l.kind !== "del" && l.newLine === line);

/**
 * Decide which inline comments to post: skip anything whose fingerprint is already on
 * the PR (so a new push never repeats a comment), and anything GitHub would reject
 * because its line isn't in the diff.
 */
export function planReview(input: PlanInput): ReviewPlan {
  const posted = new Set(input.existingBodies.map(readFingerprint).filter(Boolean));
  const byPath = new Map(input.files.map((f) => [f.path, f]));
  const post: InlineComment[] = [];
  const seen = new Set<string>();
  let alreadyPosted = 0;

  for (const finding of input.findings) {
    const hunk = byPath.get(finding.file)?.hunks.find((h) => visible(h, finding.line));
    const line = hunk && visible(hunk, finding.line);
    if (!hunk || !line) continue;

    const fp = fingerprint(finding, line.content);
    if (posted.has(fp)) {
      alreadyPosted++;
      continue;
    }
    if (seen.has(fp)) continue;
    seen.add(fp);

    const multiLine = finding.endLine !== undefined && visible(hunk, finding.endLine) !== undefined;
    post.push({
      path: finding.file,
      ...(multiLine
        ? { startLine: finding.line, line: finding.endLine as number }
        : { line: finding.line }),
      side: "RIGHT",
      body: inlineBody(finding, fp),
    });
  }
  return { post, alreadyPosted };
}

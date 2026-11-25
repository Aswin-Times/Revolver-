import type { FileDiff, Finding, Hunk } from "@pr-mentor/core";
import { inlineBody, type ExistingInlineComment, type InlineComment } from "./comments.js";
import { fingerprint, readFingerprint } from "./fingerprint.js";

export interface PlanInput {
  findings: Finding[];
  files: FileDiff[];
  existingComments: ExistingInlineComment[];
}

export interface ReviewPlan {
  post: InlineComment[];
  alreadyPosted: number;
}

const visible = (hunk: Hunk, line: number) =>
  hunk.lines.find((l) => l.kind !== "del" && l.newLine === line);
const occurrence = (path: string, line: number, fp: string) => JSON.stringify([path, line, fp]);

/**
 * Match each fingerprint to GitHub's current anchor so identical findings on different
 * lines each get a comment. A missing anchor cannot suppress a finding.
 */
export function planReview(input: PlanInput): ReviewPlan {
  const posted = new Set(
    input.existingComments.flatMap(({ body, path, line }) => {
      const fp = readFingerprint(body);
      return fp ? [occurrence(path, line, fp)] : [];
    }),
  );
  const byPath = new Map(input.files.map((f) => [f.path, f]));
  const post: InlineComment[] = [];
  const seen = new Set<string>();
  let alreadyPosted = 0;

  for (const finding of input.findings) {
    const hunk = byPath.get(finding.file)?.hunks.find((h) => visible(h, finding.line));
    const line = hunk && visible(hunk, finding.line);
    if (!hunk || !line) continue;

    const fp = fingerprint(finding, line.content);
    const key = occurrence(finding.file, finding.line, fp);
    if (seen.has(key)) continue;
    seen.add(key);
    if (posted.has(key)) {
      alreadyPosted++;
      continue;
    }
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

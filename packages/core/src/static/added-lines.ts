import type { FileDiff } from "../diff/types.js";
import type { Finding } from "../finding.js";

/** New-side line numbers that each file's diff added. */
export function addedLineMap(files: FileDiff[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    const lines = new Set<number>();
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) if (line.kind === "add") lines.add(line.newLine);
    }
    map.set(file.path, lines);
  }
  return map;
}

/**
 * Keep only findings that touch a line the PR added. We review the change, not code that
 * was already there, and GitHub can only place inline comments on lines in the diff.
 */
export function keepOnAddedLines(findings: Finding[], files: FileDiff[]): Finding[] {
  const added = addedLineMap(files);
  return findings.filter((finding) => {
    const lines = added.get(finding.file);
    if (!lines) return false;
    const end = finding.endLine ?? finding.line;
    for (const line of lines) if (line >= finding.line && line <= end) return true;
    return false;
  });
}

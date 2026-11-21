import { filterFiles } from "./filters.js";
import { parseDiff } from "./parse.js";
import type { FileDiff, SkippedFile } from "./types.js";

export interface DiffLimits {
  /** Max reviewable files (counted after filtering). */
  maxFiles: number;
  /** Max added + deleted lines in reviewable files (counted after filtering). */
  maxChangedLines: number;
  /** Max raw input size in UTF-8 bytes, checked before parsing as a safety guard. */
  maxBytes: number;
}

export const DEFAULT_LIMITS: Readonly<DiffLimits> = {
  maxFiles: 100,
  maxChangedLines: 3000,
  maxBytes: 5_000_000,
};

export interface DiffStats {
  bytes: number;
  /** File and line counts cover reviewable files only. Zero when the input wasn't parsed. */
  files: number;
  additions: number;
  deletions: number;
}

export type PreparedDiff =
  | { status: "ok"; files: FileDiff[]; skipped: SkippedFile[]; stats: DiffStats }
  | {
      status: "too_large";
      limit: "bytes" | "files" | "changedLines";
      /** Friendly explanation for the student. */
      message: string;
      skipped: SkippedFile[];
      stats: DiffStats;
    };

const SPLIT_ADVICE =
  "Try splitting it into smaller PRs. Smaller PRs are easier for human reviewers too!";

/**
 * Parse, filter and size-check a raw diff. This is the first step of every review.
 * Throws DiffParseError if the input isn't a valid diff.
 */
export function prepareDiff(raw: string, limits: Partial<DiffLimits> = {}): PreparedDiff {
  const { maxFiles, maxChangedLines, maxBytes } = { ...DEFAULT_LIMITS, ...limits };

  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > maxBytes) {
    return {
      status: "too_large",
      limit: "bytes",
      message: `This diff is ${formatBytes(bytes)}, too big to review in one pass (limit: ${formatBytes(maxBytes)}). ${SPLIT_ADVICE}`,
      skipped: [],
      stats: { bytes, files: 0, additions: 0, deletions: 0 },
    };
  }

  const { kept, skipped } = filterFiles(parseDiff(raw));
  const additions = kept.reduce((sum, f) => sum + f.additions, 0);
  const deletions = kept.reduce((sum, f) => sum + f.deletions, 0);
  const stats: DiffStats = { bytes, files: kept.length, additions, deletions };
  const changed = additions + deletions;

  if (changed > maxChangedLines) {
    return {
      status: "too_large",
      limit: "changedLines",
      message: `This PR changes ${count(changed, "line")} across ${count(kept.length, "file")}, more than I can review well in one pass (limit: ${count(maxChangedLines, "line")}). ${SPLIT_ADVICE}`,
      skipped,
      stats,
    };
  }

  if (kept.length > maxFiles) {
    return {
      status: "too_large",
      limit: "files",
      message: `This PR touches ${count(kept.length, "file")}, more than I can review well in one pass (limit: ${count(maxFiles, "file")}). ${SPLIT_ADVICE}`,
      skipped,
      stats,
    };
  }

  return { status: "ok", files: kept, skipped, stats };
}

const count = (n: number, noun: string) =>
  `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

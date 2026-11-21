/** One line inside a hunk. Line numbers are 1-based. */
export type DiffLine =
  | { kind: "add"; content: string; newLine: number }
  | { kind: "del"; content: string; oldLine: number }
  | { kind: "context"; content: string; oldLine: number; newLine: number };

export interface Hunk {
  /** The full `@@ -a,b +c,d @@ section` line. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface FileDiff {
  /** Repo-relative path on the new side (the old path for deleted files). */
  path: string;
  /** Set only for renames. */
  oldPath?: string;
  status: FileStatus;
  isBinary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

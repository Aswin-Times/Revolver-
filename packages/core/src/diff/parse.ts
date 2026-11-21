import type { DiffLine, FileDiff, FileStatus, Hunk } from "./types.js";

export class DiffParseError extends Error {
  override name = "DiffParseError";
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Paths collected while reading one file's headers. `null` means /dev/null. */
interface FileBuilder {
  gitOld?: string;
  gitNew?: string;
  oldPath?: string | null;
  newPath?: string | null;
  renameFrom?: string;
  renameTo?: string;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: Hunk[];
}

const newBuilder = (): FileBuilder => ({
  isNew: false,
  isDeleted: false,
  isBinary: false,
  hunks: [],
});

/**
 * Parse a unified diff (git or plain `diff -u` format) into files and hunks.
 *
 * Hunk bodies are read by the line counts in their `@@` header, never by pattern, so
 * content such as a removed SQL comment (`--- note`) can't be mistaken for a header.
 * The input is untrusted: anything that doesn't fit the format throws DiffParseError.
 */
export function parseDiff(raw: string): FileDiff[] {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.every((line) => line.trim() === "")) return [];

  const files: FileDiff[] = [];
  let current: FileBuilder | null = null;

  const finish = () => {
    if (current) files.push(buildFile(current));
    current = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const next = lines[i + 1];

    if (line.startsWith("diff --git ")) {
      finish();
      current = newBuilder();
      const paths = parseGitHeaderPaths(line.slice("diff --git ".length));
      if (paths) [current.gitOld, current.gitNew] = paths;
      i++;
      continue;
    }

    if (line.startsWith("--- ") && next?.startsWith("+++ ")) {
      // In git format this follows `diff --git`; in plain format it starts a new file.
      if (!current || current.oldPath !== undefined || current.hunks.length > 0) {
        finish();
        current = newBuilder();
      }
      current.oldPath = parseFileHeaderPath(line.slice(4), "a/");
      current.newPath = parseFileHeaderPath(next.slice(4), "b/");
      i += 2;
      continue;
    }

    if (current) {
      const hunkMatch = HUNK_HEADER.exec(line);
      if (hunkMatch) {
        i = readHunk(lines, i, hunkMatch, current);
        continue;
      }
      if (line.startsWith("new file mode ")) current.isNew = true;
      else if (line.startsWith("deleted file mode ")) current.isDeleted = true;
      else if (line.startsWith("rename from ")) current.renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) current.renameTo = unquote(line.slice(10));
      else if (line === "GIT binary patch") current.isBinary = true;
      else if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
        current.isBinary = true;
      }
    }
    // Anything else (index lines, format-patch preambles, binary payloads) is skipped.
    i++;
  }
  finish();

  if (files.length === 0) {
    throw new DiffParseError(
      "This doesn't look like a unified diff: no file headers ('diff --git' or '---'/'+++') " +
        "were found. Try generating one with `git diff main...HEAD`.",
    );
  }
  return files;
}

/** Reads one hunk starting at its header line; returns the index of the line after it. */
function readHunk(lines: string[], start: number, match: RegExpExecArray, file: FileBuilder) {
  const oldStart = Number(match[1]);
  const oldLines = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newLines = match[4] === undefined ? 1 : Number(match[4]);
  const hunk: Hunk = {
    header: lines[start] ?? "",
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines: [],
  };

  const name = displayName(file);
  let oldLeft = oldLines;
  let newLeft = newLines;
  let oldNo = oldStart;
  let newNo = newStart;
  let i = start + 1;

  while (oldLeft > 0 || newLeft > 0) {
    const line = lines[i];
    if (line === undefined) {
      throw new DiffParseError(
        `The diff for ${name} ends in the middle of a hunk (${hunk.header}). Was it cut off?`,
      );
    }
    const prefix = line.charAt(0);
    let parsed: DiffLine | undefined;

    // A blank line is an empty context line whose leading space was stripped.
    if ((prefix === " " || line === "") && oldLeft > 0 && newLeft > 0) {
      parsed = { kind: "context", content: line.slice(1), oldLine: oldNo++, newLine: newNo++ };
      oldLeft--;
      newLeft--;
    } else if (prefix === "-" && oldLeft > 0) {
      parsed = { kind: "del", content: line.slice(1), oldLine: oldNo++ };
      oldLeft--;
    } else if (prefix === "+" && newLeft > 0) {
      parsed = { kind: "add", content: line.slice(1), newLine: newNo++ };
      newLeft--;
    } else if (prefix !== "\\") {
      throw new DiffParseError(
        `Line ${i + 1} of the diff for ${name} doesn't match its hunk header (${hunk.header}).`,
      );
    }

    if (parsed) hunk.lines.push(parsed);
    i++;
  }

  file.hunks.push(hunk);
  return i;
}

function buildFile(b: FileBuilder): FileDiff {
  const oldPath = b.renameFrom ?? b.oldPath ?? b.gitOld;
  const newPath = b.renameTo ?? b.newPath ?? b.gitNew;

  let status: FileStatus;
  if (b.isNew || b.oldPath === null) status = "added";
  else if (b.isDeleted || b.newPath === null) status = "deleted";
  else if (oldPath !== undefined && newPath !== undefined && oldPath !== newPath) {
    status = "renamed";
  } else status = "modified";

  const path = status === "deleted" ? (oldPath ?? b.gitNew) : (newPath ?? b.gitOld);
  if (path === undefined || path === null) {
    throw new DiffParseError("Couldn't work out a file name from one of the diff's headers.");
  }

  let additions = 0;
  let deletions = 0;
  for (const hunk of b.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") additions++;
      else if (line.kind === "del") deletions++;
    }
  }

  return {
    path,
    ...(status === "renamed" && oldPath ? { oldPath } : {}),
    status,
    isBinary: b.isBinary,
    hunks: b.hunks,
    additions,
    deletions,
  };
}

function displayName(b: FileBuilder): string {
  return b.newPath ?? b.oldPath ?? b.gitNew ?? b.gitOld ?? "an unnamed file";
}

/** `--- a/path\t<timestamp>` → `path`; `/dev/null` → null. */
function parseFileHeaderPath(value: string, prefix: string): string | null {
  const tab = value.indexOf("\t");
  const raw = tab === -1 ? value : value.slice(0, tab);
  if (raw === "/dev/null") return null;
  return stripPrefix(unquote(raw), prefix);
}

/** Splits the `a/old b/new` part of a `diff --git` line, coping with spaces and quotes. */
function parseGitHeaderPaths(rest: string): [string, string] | undefined {
  let oldRaw: string;
  let newRaw: string;

  if (rest.startsWith('"')) {
    const end = closingQuote(rest, 0);
    if (end === -1) return undefined;
    oldRaw = rest.slice(0, end + 1);
    newRaw = rest.slice(end + 2);
  } else if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start === -1) return undefined;
    oldRaw = rest.slice(0, start);
    newRaw = rest.slice(start + 1);
  } else {
    // Same path on both sides (the usual case): "a/P b/P" splits exactly in the middle.
    const mid = (rest.length - 1) / 2;
    if (Number.isInteger(mid) && rest[mid] === " " && rest.slice(2, mid) === rest.slice(mid + 3)) {
      oldRaw = rest.slice(0, mid);
      newRaw = rest.slice(mid + 1);
    } else {
      const split = rest.indexOf(" b/");
      if (split === -1) return undefined;
      oldRaw = rest.slice(0, split);
      newRaw = rest.slice(split + 1);
    }
  }
  return [stripPrefix(unquote(oldRaw), "a/"), stripPrefix(unquote(newRaw), "b/")];
}

function closingQuote(value: string, open: number): number {
  for (let i = open + 1; i < value.length; i++) {
    if (value[i] === "\\") i++;
    else if (value[i] === '"') return i;
  }
  return -1;
}

const stripPrefix = (path: string, prefix: string) =>
  path.startsWith(prefix) ? path.slice(prefix.length) : path;

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** Decodes git's C-style quoted paths, e.g. `"caf\303\251.py"` → `café.py`. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const inner = value.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let i = 0; i < inner.length; i++) {
    const ch = inner.charAt(i);
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const next = inner.charAt(i + 1);
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next] ?? 0);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

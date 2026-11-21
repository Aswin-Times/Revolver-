import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type { FileDiff } from "../diff/types.js";
import type { RepoContext } from "../repo.js";

export interface WorkspaceFile {
  /** Repo-relative path, as in the diff. */
  path: string;
  /** Where the file was written inside the workspace. */
  absPath: string;
  /** True when rebuilt from the diff because the full contents were unavailable. */
  partial: boolean;
}

export interface WorkspaceSkip {
  path: string;
  reason: "unsafe-path" | "tool-config" | "write-failed";
}

export interface Workspace {
  /** Temp directory that owns everything; removed by dispose(). */
  dir: string;
  /** Where repo files are written. Tools scan this. */
  root: string;
  files: WorkspaceFile[];
  skipped: WorkspaceSkip[];
  /** Map a path a tool reported (absolute, or relative to root) back to its repo path. */
  toRepoPath(toolPath: string): string | undefined;
  dispose(): Promise<void>;
}

/**
 * Config files that would let a repo change how our tools behave (ignore lists, rule
 * overrides, executable ESLint configs). They are never copied into the workspace.
 */
const TOOL_CONFIG_FILES = new Set([
  ".gitleaks.toml",
  ".gitleaksignore",
  ".semgrepignore",
  "ruff.toml",
  ".ruff.toml",
  "pyproject.toml",
  ".eslintignore",
]);
const ESLINT_CONFIG = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;

const isToolConfig = (path: string) => {
  const base = posix.basename(path);
  return TOOL_CONFIG_FILES.has(base) || ESLINT_CONFIG.test(base);
};

/**
 * A path from an untrusted diff is safe to write only if it is plain and relative:
 * no `..`, `.` or empty segments, no leading slash, no backslashes, colons or NUL bytes.
 */
export function isSafeRepoPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /[\\:\0]/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Lines of the new file that the diff shows, at their line numbers; blanks elsewhere. */
function rebuildFromDiff(file: FileDiff): string {
  const known = new Map<number, string>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "del") known.set(line.newLine, line.content);
    }
  }
  const last = Math.max(0, ...known.keys());
  return Array.from({ length: last }, (_, i) => known.get(i + 1) ?? "").join("\n") + "\n";
}

const caseKey = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

/**
 * Copy the post-change version of the changed files into a fresh temp directory so
 * static tools can scan them in isolation from the student's checkout and its configs.
 */
export async function createWorkspace(files: FileDiff[], repo: RepoContext): Promise<Workspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pr-mentor-")));
  const root = join(dir, "repo");
  await mkdir(root);

  const written: WorkspaceFile[] = [];
  const skipped: WorkspaceSkip[] = [];
  const byKey = new Map<string, string>();

  for (const file of files) {
    if (!isSafeRepoPath(file.path)) {
      skipped.push({ path: file.path, reason: "unsafe-path" });
      continue;
    }
    if (isToolConfig(file.path)) {
      skipped.push({ path: file.path, reason: "tool-config" });
      continue;
    }
    const absPath = resolve(root, ...file.path.split("/"));
    if (!absPath.startsWith(root + sep)) {
      skipped.push({ path: file.path, reason: "unsafe-path" });
      continue;
    }

    const full = await repo.readFile(file.path);
    try {
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, full ?? rebuildFromDiff(file));
    } catch {
      skipped.push({ path: file.path, reason: "write-failed" });
      continue;
    }
    written.push({ path: file.path, absPath, partial: full === undefined });
    byKey.set(caseKey(file.path), file.path);
  }

  return {
    dir,
    root,
    files: written,
    skipped,
    toRepoPath(toolPath) {
      const rel = relative(root, resolve(root, toolPath));
      if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
        const hit = byKey.get(caseKey(rel.split(sep).join("/")));
        if (hit) return hit;
      }
      // Some tools resolve the temp dir differently (e.g. /private/var on macOS).
      const normalized = caseKey(posix.normalize(toolPath.split("\\").join("/")));
      for (const [key, repoPath] of byKey) {
        if (normalized.endsWith(`/repo/${key}`)) return repoPath;
      }
      return undefined;
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

import type { FileDiff } from "../diff/types.js";
import type { RepoContext } from "../repo.js";

/**
 * Wrap a RepoContext so it only returns file contents that match every line the diff
 * shows for that file. A stale or unrelated working tree would otherwise make tool line
 * numbers drift away from the diff; returning undefined makes the workspace rebuild the
 * file from the diff instead.
 */
export function verifiedRepo(files: FileDiff[], repo: RepoContext): RepoContext {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return {
    async readFile(path) {
      const content = await repo.readFile(path);
      const file = byPath.get(path);
      if (content === undefined || !file) return content;
      const lines = content.split(/\r?\n/);
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind !== "del" && lines[line.newLine - 1] !== line.content) return undefined;
        }
      }
      return content;
    },
    ...(repo.listFiles ? { listFiles: () => repo.listFiles?.() ?? Promise.resolve([]) } : {}),
  };
}

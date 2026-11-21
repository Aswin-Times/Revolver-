import type { FileDiff } from "../diff/types.js";
import { classifyFile } from "../test-gap/classify.js";

/** Lower = left out first: docs/config, then tests, then source code. */
const KEEP_PRIORITY = { ignored: 0, test: 1, source: 2 } as const;

/** Rough size of a file in the prompt; only used to estimate tokens between counts. */
function weight(file: FileDiff): number {
  let total = file.path.length + 40;
  for (const hunk of file.hunks) {
    total += hunk.header.length;
    for (const line of hunk.lines) total += line.content.length + 12;
  }
  return total;
}

/** Least important first; within a priority, the biggest file first. */
function dropOrder(files: FileDiff[]): FileDiff[] {
  return [...files].sort(
    (a, b) =>
      KEEP_PRIORITY[classifyFile(a.path)] - KEEP_PRIORITY[classifyFile(b.path)] ||
      weight(b) - weight(a),
  );
}

export interface BudgetPlan {
  files: FileDiff[];
  omitted: FileDiff[];
  tokens: number;
}

const MAX_ROUNDS = 4;

/**
 * Choose which files fit in the input-token budget. Counts the real prompt, estimates
 * how many least-important files to leave out, then counts again to confirm.
 * Returns undefined when not even the most important file fits.
 */
export async function fitToBudget(
  files: FileDiff[],
  count: (files: FileDiff[]) => Promise<number>,
  maxInputTokens: number,
): Promise<BudgetPlan | undefined> {
  let kept = [...files];
  const omitted: FileDiff[] = [];

  for (let round = 0; round < MAX_ROUNDS && kept.length > 0; round++) {
    const tokens = await count(kept);
    if (tokens <= maxInputTokens) return { files: kept, omitted, tokens };

    const tokensPerUnit = tokens / kept.reduce((sum, file) => sum + weight(file), 0);
    let estimate = tokens;
    for (const file of dropOrder(kept)) {
      if (estimate <= maxInputTokens * 0.9) break;
      estimate -= weight(file) * tokensPerUnit;
      omitted.push(file);
      kept = kept.filter((f) => f !== file);
    }
  }
  return undefined;
}

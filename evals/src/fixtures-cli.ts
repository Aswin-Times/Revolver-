import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDiff, CASES_DIR } from "./fixtures.js";

/** Regenerate every case's pr.diff from its before/ and after/ trees. */
let changed = 0;
for (const id of (await readdir(CASES_DIR)).sort()) {
  const dir = join(CASES_DIR, id);
  const diff = await buildDiff(dir);
  const current = await readFile(join(dir, "pr.diff"), "utf8").catch(() => "");
  if (diff !== current) {
    await writeFile(join(dir, "pr.diff"), diff);
    changed++;
    console.log(`updated ${id}/pr.diff`);
  }
}
console.log(changed === 0 ? "All fixtures up to date." : `${changed} fixture(s) updated.`);

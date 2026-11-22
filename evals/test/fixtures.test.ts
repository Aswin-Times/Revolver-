import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildDiff, CASES_DIR } from "../src/fixtures.js";

const root = mkdtempSync(join(tmpdir(), "pr-mentor-fixture-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const put = (path: string, content: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
};

describe("buildDiff", () => {
  it("diffs before/ against after/ with real git: additions, edits and deletions", async () => {
    const dir = join(root, "case");
    put(join(dir, "before", "app.py"), "def old():\n    return 1\n");
    put(join(dir, "before", "gone.txt"), "bye\n");
    put(join(dir, "after", "app.py"), "def old():\n    return 2\n");
    put(join(dir, "after", "src", "new.js"), "export const x = 1;\n");

    const diff = await buildDiff(dir);
    expect(diff).toContain("+++ b/app.py");
    expect(diff).toContain("-    return 1\n+    return 2");
    expect(diff).toContain("+++ b/src/new.js");
    expect(diff).toContain("+++ /dev/null");
    expect(await buildDiff(dir)).toBe(diff);
  });

  it("works when the case has no before/ folder", async () => {
    const dir = join(root, "fresh");
    put(join(dir, "after", "a.py"), "x = 1\n");
    expect(await buildDiff(dir)).toContain("--- /dev/null\n+++ b/a.py");
  });
});

describe("committed fixtures", () => {
  const cases = readdirSync(CASES_DIR);

  it.each(cases)("%s: pr.diff is up to date (run pnpm eval:fixtures)", async (id) => {
    const dir = join(CASES_DIR, id);
    expect(await buildDiff(dir)).toBe(readFileSync(join(dir, "pr.diff"), "utf8"));
  });
});

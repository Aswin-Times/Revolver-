import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CaseMetaSchema,
  fillPlaceholders,
  loadCase,
  loadCases,
  PLACEHOLDERS,
} from "../src/case.js";

const root = mkdtempSync(join(tmpdir(), "pr-mentor-cases-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeCase(
  id: string,
  yaml: string,
  files: Record<string, string>,
  diff = "--- /dev/null\n+++ b/app.py\n@@ -0,0 +1 @@\n+x = 1\n",
) {
  const dir = join(root, id);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, "after", path, ".."), { recursive: true });
    writeFileSync(join(dir, "after", path), content);
  }
  writeFileSync(join(dir, "case.yaml"), yaml);
  writeFileSync(join(dir, "pr.diff"), diff);
  return dir;
}

const META = `title: SQL injection in a Flask route
tags: [security, python]
groundTruth: human-written
expected:
  - file: app.py
    lines: [3, 3]
    category: security
    why: f-string SQL with request data
allowed:
  - file: app.py
    category: quality
`;

describe("CaseMetaSchema", () => {
  it("accepts a case with expected and allowed findings, defaulting clean to false", () => {
    const meta = CaseMetaSchema.parse({
      title: "t",
      tags: ["x"],
      groundTruth: "human-written",
      expected: [{ file: "a.py", lines: [1, 2], category: "tests", why: "w" }],
    });
    expect(meta).toMatchObject({ clean: false, allowed: [] });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ lines: [5, 2] }, "end before start"],
    [{ category: "style" }, "unknown category"],
    [{ why: "" }, "no reason"],
  ])("rejects an expected finding with %j (%s)", (override) => {
    const result = CaseMetaSchema.safeParse({
      title: "t",
      tags: [],
      groundTruth: "human-written",
      expected: [{ file: "a.py", lines: [1, 2], category: "tests", why: "w", ...override }],
    });
    expect(result.success).toBe(false);
  });

  it("requires a clean case to expect nothing", () => {
    const result = CaseMetaSchema.safeParse({
      title: "t",
      tags: [],
      groundTruth: "human-written",
      clean: true,
      expected: [{ file: "a.py", lines: [1, 1], category: "tests", why: "w" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("fillPlaceholders", () => {
  it("swaps {{NAME}} for the secret assembled at runtime and leaves unknown names alone", () => {
    const key = PLACEHOLDERS.AWS_ACCESS_KEY_ID ?? "";
    expect(key).toMatch(/^AKIA[A-Z2-7]{16}$/);
    expect(fillPlaceholders('KEY = "{{AWS_ACCESS_KEY_ID}}" # {{NOPE}}')).toBe(
      `KEY = "${key}" # {{NOPE}}`,
    );
  });
});

describe("loadCase", () => {
  it("loads metadata, the diff and the after/ tree as a RepoContext, with placeholders filled", async () => {
    const dir = writeCase(
      "sqli",
      META,
      { "app.py": 'KEY = "{{AWS_ACCESS_KEY_ID}}"\n', "lib/util.py": "y = 2\n" },
      '--- /dev/null\n+++ b/app.py\n@@ -0,0 +1 @@\n+KEY = "{{AWS_ACCESS_KEY_ID}}"\n',
    );
    const loaded = await loadCase(dir);
    const key = PLACEHOLDERS.AWS_ACCESS_KEY_ID ?? "";
    expect(loaded.id).toBe("sqli");
    expect(loaded.meta.title).toBe("SQL injection in a Flask route");
    expect(loaded.diff).toContain(key);
    expect(await loaded.repo.readFile("app.py")).toBe(`KEY = "${key}"\n`);
    expect(await loaded.repo.readFile("../case.yaml")).toBeUndefined();
    expect(await loaded.repo.readFile("missing.py")).toBeUndefined();
    expect((await loaded.repo.listFiles?.())?.sort()).toEqual(["app.py", "lib/util.py"]);
  });

  it("explains which case is broken", async () => {
    const dir = writeCase("broken", "title: 3\n", { "app.py": "x\n" });
    await expect(loadCase(dir)).rejects.toThrow(/broken/);
  });

  it("loads every case in a folder, sorted, optionally filtered by id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-mentor-cases-"));
    for (const id of ["b-case", "a-case"]) {
      mkdirSync(join(dir, id, "after"), { recursive: true });
      writeFileSync(join(dir, id, "case.yaml"), META);
      writeFileSync(join(dir, id, "pr.diff"), "--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+x\n");
    }
    expect((await loadCases(dir)).map((c) => c.id)).toEqual(["a-case", "b-case"]);
    expect((await loadCases(dir, ["b-case"])).map((c) => c.id)).toEqual(["b-case"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

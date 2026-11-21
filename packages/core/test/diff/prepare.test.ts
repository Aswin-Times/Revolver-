import { describe, expect, it } from "vitest";
import { DiffParseError } from "../../src/diff/parse.js";
import { prepareDiff } from "../../src/diff/prepare.js";

/** A git diff section that adds `added` lines to `path` and removes `removed` lines. */
const section = (path: string, added: number, removed = 0) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${removed} +1,${added} @@`,
    ...Array.from({ length: removed }, (_, i) => `-old ${i + 1}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i + 1}`),
  ].join("\n");

const diffOf = (...sections: string[]) => sections.join("\n") + "\n";

describe("prepareDiff", () => {
  it("returns only reviewable files, the skipped list and stats for kept files", () => {
    const result = prepareDiff(
      diffOf(
        section("app/routes.py", 4, 1),
        section("package-lock.json", 40),
        section("app/db.py", 2),
      ),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.files.map((f) => f.path)).toEqual(["app/routes.py", "app/db.py"]);
    expect(result.skipped).toEqual([{ path: "package-lock.json", reason: "lockfile" }]);
    expect(result.stats).toMatchObject({ files: 2, additions: 6, deletions: 1 });
  });

  it("returns ok with no files when every file was filtered out", () => {
    const result = prepareDiff(diffOf(section("yarn.lock", 10)));
    expect(result).toMatchObject({ status: "ok", files: [] });
    expect(result.skipped).toEqual([{ path: "yarn.lock", reason: "lockfile" }]);
  });

  it("refuses a diff with too many changed lines and says how big it is", () => {
    const result = prepareDiff(diffOf(section("app/a.py", 8, 4)), { maxChangedLines: 10 });
    expect(result.status).toBe("too_large");
    if (result.status !== "too_large") return;
    expect(result.limit).toBe("changedLines");
    expect(result.message).toContain("12");
    expect(result.message).toContain("10");
  });

  it("accepts a diff exactly at the changed-lines limit", () => {
    const result = prepareDiff(diffOf(section("app/a.py", 6, 4)), { maxChangedLines: 10 });
    expect(result.status).toBe("ok");
  });

  it("refuses a diff touching too many files", () => {
    const result = prepareDiff(diffOf(section("a.py", 1), section("b.py", 1), section("c.py", 1)), {
      maxFiles: 2,
    });
    expect(result).toMatchObject({ status: "too_large", limit: "files" });
    if (result.status === "too_large") expect(result.message).toContain("3");
  });

  it("counts limits after filtering, so a big lockfile change doesn't block review", () => {
    const result = prepareDiff(
      diffOf(
        section("package-lock.json", 500),
        section("node_modules/x/index.js", 500),
        section("app.py", 3),
      ),
      { maxChangedLines: 10, maxFiles: 1 },
    );
    expect(result.status).toBe("ok");
  });

  it("refuses oversized input before parsing it", () => {
    // Not a valid diff: parsing would throw, so ok/too_large proves we never parsed.
    const result = prepareDiff("x".repeat(101), { maxBytes: 100 });
    expect(result).toMatchObject({ status: "too_large", limit: "bytes" });
  });

  it("measures the byte limit in UTF-8 bytes, not characters", () => {
    // 40 characters of "é" are 80 bytes.
    const result = prepareDiff("é".repeat(40), { maxBytes: 79 });
    expect(result).toMatchObject({ status: "too_large", limit: "bytes" });
  });

  it("keeps the other default limits when only some are overridden", () => {
    const big = diffOf(section("app/big.py", 3001));
    expect(prepareDiff(big).status).toBe("too_large");
    expect(prepareDiff(big, { maxFiles: 50 }).status).toBe("too_large");
    expect(prepareDiff(big, { maxChangedLines: 5000 }).status).toBe("ok");
  });

  it("lets DiffParseError through for malformed input", () => {
    expect(() => prepareDiff("just some notes, not a diff\n")).toThrow(DiffParseError);
  });
});

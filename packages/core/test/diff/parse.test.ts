import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DiffParseError, parseDiff } from "../../src/diff/parse.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** Build a diff from explicit lines so significant whitespace stays visible. */
const diff = (...lines: string[]) => lines.join("\n") + "\n";

describe("parseDiff: real git output (fixtures/multi-file.diff)", () => {
  const files = parseDiff(fixture("multi-file.diff"));
  const byPath = (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file) throw new Error(`no file ${path} in ${files.map((f) => f.path).join(", ")}`);
    return file;
  };

  it("finds every file in order", () => {
    expect(files.map((f) => f.path)).toEqual([
      "docs/moved.md",
      "logo.png",
      "remove_me.txt",
      "script.sh",
      "src/café.py",
      "src/calc.py",
      "src/new file.py",
      "src/new_name.py",
    ]);
  });

  it("numbers lines in a modified file with two hunks", () => {
    const calc = byPath("src/calc.py");
    expect(calc.status).toBe("modified");
    expect(calc.isBinary).toBe(false);
    expect(calc.additions).toBe(3);
    expect(calc.deletions).toBe(2);
    expect(calc.hunks).toHaveLength(2);

    const [first, second] = calc.hunks;
    expect(first).toMatchObject({ oldStart: 1, oldLines: 6, newStart: 1, newLines: 6 });
    expect(first?.lines.slice(0, 5)).toEqual([
      { kind: "context", content: "line 1", oldLine: 1, newLine: 1 },
      { kind: "context", content: "line 2", oldLine: 2, newLine: 2 },
      { kind: "del", content: "line 3", oldLine: 3 },
      { kind: "add", content: "line three", newLine: 3 },
      { kind: "context", content: "line 4", oldLine: 4, newLine: 4 },
    ]);

    expect(second).toMatchObject({
      header: "@@ -15,6 +15,7 @@ line 14",
      oldStart: 15,
      oldLines: 6,
      newStart: 15,
      newLines: 7,
    });
    expect(second?.lines.slice(3)).toEqual([
      { kind: "del", content: "line 18", oldLine: 18 },
      { kind: "add", content: "line eighteen", newLine: 18 },
      { kind: "add", content: "line 18.5", newLine: 19 },
      { kind: "context", content: "line 19", oldLine: 19, newLine: 20 },
      { kind: "context", content: "line 20", oldLine: 20, newLine: 21 },
    ]);
  });

  it("parses a new file (old side /dev/null)", () => {
    const file = byPath("src/new file.py");
    expect(file.status).toBe("added");
    expect(file.oldPath).toBeUndefined();
    expect(file.additions).toBe(1);
    expect(file.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1 });
    expect(file.hunks[0]?.lines).toEqual([{ kind: "add", content: "x = 1", newLine: 1 }]);
  });

  it("parses a deleted file (new side /dev/null) under its old path", () => {
    const file = byPath("remove_me.txt");
    expect(file.status).toBe("deleted");
    expect(file.deletions).toBe(2);
    expect(file.hunks[0]?.lines).toEqual([
      { kind: "del", content: "temporary", oldLine: 1 },
      { kind: "del", content: "file", oldLine: 2 },
    ]);
  });

  it("parses a rename with content changes, keeping empty context lines", () => {
    const file = byPath("src/new_name.py");
    expect(file.status).toBe("renamed");
    expect(file.oldPath).toBe("src/old_name.py");
    expect(file.hunks[0]?.lines).toEqual([
      { kind: "context", content: "def greet(name):", oldLine: 1, newLine: 1 },
      { kind: "del", content: '    return "hi " + name', oldLine: 2 },
      { kind: "add", content: '    return "hello " + name', newLine: 2 },
      { kind: "context", content: "", oldLine: 3, newLine: 3 },
      { kind: "context", content: "", oldLine: 4, newLine: 4 },
      { kind: "context", content: "def bye():", oldLine: 5, newLine: 5 },
    ]);
  });

  it("parses a pure rename with no hunks", () => {
    const file = byPath("docs/moved.md");
    expect(file).toMatchObject({ status: "renamed", oldPath: "docs/same.md", hunks: [] });
  });

  it("parses a mode-only change as modified with no hunks", () => {
    expect(byPath("script.sh")).toMatchObject({
      status: "modified",
      hunks: [],
      additions: 0,
      deletions: 0,
    });
  });

  it("flags 'Binary files ... differ' as binary", () => {
    expect(byPath("logo.png")).toMatchObject({ isBinary: true, status: "modified", hunks: [] });
  });

  it("decodes git's octal-quoted non-ASCII paths", () => {
    const file = byPath("src/café.py");
    expect(file.status).toBe("added");
    expect(file.hunks[0]?.lines).toEqual([{ kind: "add", content: 'print("café")', newLine: 1 }]);
  });

  it("parses CRLF input the same as LF input", () => {
    const crlf = fixture("multi-file.diff").replace(/\n/g, "\r\n");
    expect(parseDiff(crlf)).toEqual(files);
  });
});

describe("parseDiff: edge cases", () => {
  it("flags a GIT binary patch as binary and skips its payload", () => {
    const files = parseDiff(fixture("binary-patch.diff"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "logo.png", isBinary: true, hunks: [] });
  });

  it("reads lines that look like file headers as content when inside a hunk", () => {
    // A removed SQL comment "-- users table" is printed as "--- users table".
    const files = parseDiff(
      diff(
        "diff --git a/db/schema.sql b/db/schema.sql",
        "--- a/db/schema.sql",
        "+++ b/db/schema.sql",
        "@@ -1,3 +1,3 @@",
        "--- users table",
        "+++ b/fake.txt",
        " CREATE TABLE users (id INT);",
        "-SELECT 1;",
        "+SELECT 2;",
      ),
    );
    expect(files.map((f) => f.path)).toEqual(["db/schema.sql"]);
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { kind: "del", content: "-- users table", oldLine: 1 },
      { kind: "add", content: "++ b/fake.txt", newLine: 1 },
      { kind: "context", content: "CREATE TABLE users (id INT);", oldLine: 2, newLine: 2 },
      { kind: "del", content: "SELECT 1;", oldLine: 3 },
      { kind: "add", content: "SELECT 2;", newLine: 3 },
    ]);
  });

  it("ignores '\\ No newline at end of file' markers", () => {
    const files = parseDiff(
      diff(
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
      ),
    );
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { kind: "del", content: "old", oldLine: 1 },
      { kind: "add", content: "new", newLine: 1 },
    ]);
  });

  it("treats a blank line inside a hunk as an empty context line", () => {
    // Editors often strip the single space that marks an empty context line.
    const files = parseDiff(
      diff("--- a/a.py", "+++ b/a.py", "@@ -1,3 +1,3 @@", " a = 1", "", "-b = 2", "+b = 3"),
    );
    expect(files[0]?.hunks[0]?.lines).toEqual([
      { kind: "context", content: "a = 1", oldLine: 1, newLine: 1 },
      { kind: "context", content: "", oldLine: 2, newLine: 2 },
      { kind: "del", content: "b = 2", oldLine: 3 },
      { kind: "add", content: "b = 3", newLine: 3 },
    ]);
  });

  it("parses plain unified diffs without a 'diff --git' header", () => {
    const files = parseDiff(
      diff(
        "--- a/one.py\t2026-11-21 10:00:00",
        "+++ b/one.py\t2026-11-21 10:05:00",
        "@@ -1 +1 @@",
        "-x = 1",
        "+x = 2",
        "--- a/two.py",
        "+++ b/two.py",
        "@@ -2,0 +3 @@",
        "+y = 3",
      ),
    );
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["one.py", "modified"],
      ["two.py", "modified"],
    ]);
    expect(files[1]?.hunks[0]?.lines).toEqual([{ kind: "add", content: "y = 3", newLine: 3 }]);
  });

  it("detects added and deleted files from /dev/null alone (no git mode lines)", () => {
    const files = parseDiff(
      diff(
        "--- /dev/null",
        "+++ b/new.py",
        "@@ -0,0 +1 @@",
        "+x = 1",
        "--- a/gone.py",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-y = 2",
      ),
    );
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["new.py", "added"],
      ["gone.py", "deleted"],
    ]);
  });

  it("skips a git format-patch preamble and signature", () => {
    const files = parseDiff(
      diff(
        "From 1234abcd Mon Sep 17 00:00:00 2001",
        "From: Student <student@example.com>",
        "Subject: [PATCH] Fix login",
        "",
        "---",
        " app.py | 2 +-",
        " 1 file changed, 1 insertion(+), 1 deletion(-)",
        "",
        "diff --git a/app.py b/app.py",
        "--- a/app.py",
        "+++ b/app.py",
        "@@ -1 +1 @@",
        "-DEBUG = True",
        "+DEBUG = False",
        "-- ",
        "2.43.0",
      ),
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "app.py", additions: 1, deletions: 1 });
  });

  it("returns no files for empty or whitespace-only input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("\n  \n\t\n")).toEqual([]);
  });

  it("throws DiffParseError for input that is not a diff", () => {
    expect(() => parseDiff("hello there\nthis is just some text\n")).toThrow(DiffParseError);
  });

  it("throws DiffParseError naming the file when a hunk is cut short", () => {
    const truncated = diff("--- a/app.py", "+++ b/app.py", "@@ -1,3 +1,3 @@", " a = 1");
    expect(() => parseDiff(truncated)).toThrow(DiffParseError);
    expect(() => parseDiff(truncated)).toThrow(/app\.py/);
  });

  it("throws DiffParseError when a hunk contains a line with no valid prefix", () => {
    const malformed = diff("--- a/app.py", "+++ b/app.py", "@@ -1,2 +1,2 @@", " a = 1", "?b = 2");
    expect(() => parseDiff(malformed)).toThrow(DiffParseError);
  });
});

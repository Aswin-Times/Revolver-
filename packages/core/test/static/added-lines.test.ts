import { describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { Finding } from "../../src/finding.js";
import { keepOnAddedLines } from "../../src/static/added-lines.js";

// app.py: line 1 context, lines 2-3 added, line 4 context, line 9 added.
const files = parseDiff(
  [
    "--- a/app.py",
    "+++ b/app.py",
    "@@ -1,2 +1,4 @@",
    " import os",
    "+import pickle",
    "+data = pickle.loads(blob)",
    " print(data)",
    "@@ -6,0 +9 @@",
    "+eval(user_input)",
    "",
  ].join("\n"),
);

const finding = (file: string, line: number, endLine?: number): Finding => ({
  file,
  line,
  ...(endLine === undefined ? {} : { endLine }),
  category: "security",
  severity: "high",
  title: "t",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.9,
  source: "semgrep",
});

describe("keepOnAddedLines", () => {
  it("keeps findings on added lines", () => {
    const kept = keepOnAddedLines([finding("app.py", 3), finding("app.py", 9)], files);
    expect(kept.map((f) => f.line)).toEqual([3, 9]);
  });

  it("drops findings on unchanged context lines (code that was already there)", () => {
    expect(keepOnAddedLines([finding("app.py", 1), finding("app.py", 4)], files)).toEqual([]);
  });

  it("keeps a multi-line finding when any line in its range was added", () => {
    expect(keepOnAddedLines([finding("app.py", 4, 9)], files)).toHaveLength(1);
    expect(keepOnAddedLines([finding("app.py", 4, 8)], files)).toHaveLength(0);
  });

  it("drops findings in files that are not part of the diff", () => {
    expect(keepOnAddedLines([finding("other.py", 2)], files)).toEqual([]);
  });
});

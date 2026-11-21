import { posix } from "node:path";
import type { DiffLine, FileDiff } from "../diff/types.js";
import type { Finding, Reference } from "../finding.js";
import type { RepoContext } from "../repo.js";
import { classifyFile, sourceStem, testStem } from "./classify.js";
import { newFunctions, type NewFunction } from "./functions.js";

/** Edits smaller than this (with no new functions) aren't worth a "missing tests" comment. */
const MIN_MEANINGFUL_LINES = 5;

/** Added lines that don't carry behaviour: blanks, comments, imports, re-exports, brackets. */
const NOT_MEANINGFUL =
  /^\s*(?:$|#|\/\/|\/\*|\*|import\s|from\s+\S+\s+import\s|export\s+(?:\*|\{[^}]*\})\s+from\s|(?:const|let|var)\s.*=\s*require\(|[{}()[\];,]+$|"""|''')/;

const PYTEST: Reference = {
  title: "pytest: Get Started",
  url: "https://docs.pytest.org/en/stable/getting-started.html",
};
const VITEST: Reference = { title: "Vitest: Getting Started", url: "https://vitest.dev/guide/" };
const PYRAMID: Reference = {
  title: "The Practical Test Pyramid (Martin Fowler)",
  url: "https://martinfowler.com/articles/practical-test-pyramid.html",
};

const JS_TEST_EXT: Record<string, string> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
};

const addedLines = (file: FileDiff): Extract<DiffLine, { kind: "add" }>[] =>
  file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add"));

const code = (name: string) => `\`${name}\``;

/** "`a`", "`a` and `b`", "`a`, `b` and `c`", "`a`, `b`, `c` and 2 more". */
function listNames(fns: NewFunction[], max = 3): string {
  const names = fns.map((f) => code(f.name));
  if (names.length > max) return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pythonSuggestion(file: FileDiff, fns: NewFunction[], existing?: string): string {
  const modulePath = file.path.replace(/\.py$/, "").replace(/^src\//, "");
  const testPath = existing ?? `tests/test_${posix.basename(modulePath)}.py`;
  const parts = modulePath.split("/");
  const shown = fns.slice(0, 3);
  const importLine = shown.length
    ? `from ${parts.join(".")} import ${shown.map((f) => f.name).join(", ")}`
    : parts.length > 1
      ? `from ${parts.slice(0, -1).join(".")} import ${parts.at(-1) ?? ""}`
      : `import ${parts[0] ?? ""}`;
  const subjects = shown.length ? shown.map((f) => f.name) : [posix.basename(modulePath)];
  const tests = subjects.flatMap((name) => [
    "",
    "",
    `def test_${name}_typical_input():`,
    `    assert ${shown.length ? `${name}(...)` : "..."} == ...`,
    "",
    "",
    `def test_${name}_edge_cases():`,
    "    # empty input, zero, negative numbers, missing values...",
    "    ...",
  ]);
  return [`Add tests in ${code(testPath)}:`, "", "```python", importLine, ...tests, "```"].join(
    "\n",
  );
}

function jsSuggestion(file: FileDiff, fns: NewFunction[], existing?: string): string {
  const ext = posix.extname(file.path);
  const base = posix.basename(file.path, ext);
  const dir = posix.dirname(file.path);
  const testPath = existing ?? posix.join(dir, `${base}.test.${JS_TEST_EXT[ext] ?? "js"}`);
  let importPath = posix.relative(posix.dirname(testPath), posix.join(dir, base));
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  const shown = fns.slice(0, 3);
  const subjects = shown.length ? shown.map((f) => f.name) : [base];
  const blocks = subjects.flatMap((name) => [
    "",
    `describe(${JSON.stringify(name)}, () => {`,
    '  it("returns the right result for typical input", () => {',
    `    expect(${shown.length ? `${name}(/* ... */)` : "/* ... */"}).toBe(/* ... */);`,
    "  });",
    "",
    '  it("handles edge cases", () => {',
    "    // empty input, zero, negative numbers, missing values...",
    "  });",
    "});",
  ]);
  return [
    `Add tests in ${code(testPath)}:`,
    "",
    "```ts",
    'import { describe, expect, it } from "vitest"; // with Jest these are globals',
    shown.length
      ? `import { ${shown.map((f) => f.name).join(", ")} } from "${importPath}";`
      : `import * as subject from "${importPath}";`,
    ...blocks,
    "```",
  ].join("\n");
}

function suggestionFor(file: FileDiff, fns: NewFunction[], existing?: string): string {
  const ext = posix.extname(file.path);
  if (ext === ".py") return pythonSuggestion(file, fns, existing);
  if (ext in JS_TEST_EXT) return jsSuggestion(file, fns, existing);
  const what = fns.length ? listNames(fns) : "the changed code";
  return `Add a test${existing ? ` in ${code(existing)}` : ` next to ${code(file.path)}`} that calls ${what} with typical and edge-case inputs.`;
}

function toFinding(
  file: FileDiff,
  fns: NewFunction[],
  firstMeaningfulLine: number,
  existing?: string,
): Finding {
  const plural = fns.length !== 1;
  const title = fns.length
    ? `New ${plural ? "functions" : "function"} ${listNames(fns)} ${plural ? "have" : "has"} no tests`
    : `Changes to ${code(posix.basename(file.path))} come with no test changes`;
  const what = fns.length
    ? `This PR adds ${listNames(fns, 5)} to ${code(file.path)}`
    : `This PR changes ${code(file.path)}`;
  const target = fns.length ? (plural ? "them" : "it") : "these changes";
  const explanation = [
    `${what}, but no test was added or updated for ${target}.`,
    "Tests prove the code does what you think, catch mistakes when you change it later, and show reviewers how it's meant to be used.",
    "Cover the normal case and the edge cases: empty input, zero, negative numbers, missing values.",
    ...(existing ? [`${code(existing)} already exists, so add cases there.`] : []),
  ].join(" ");
  const ext = posix.extname(file.path);

  return {
    file: file.path,
    line: fns[0]?.line ?? firstMeaningfulLine,
    category: "tests",
    severity: file.status === "added" || fns.length > 0 ? "medium" : "low",
    title: title.slice(0, 120),
    explanation,
    suggestion: suggestionFor(file, fns, existing),
    references: [...(ext === ".py" ? [PYTEST] : ext in JS_TEST_EXT ? [VITEST] : []), PYRAMID],
    confidence: 0.6,
    source: "heuristic",
    ruleId: "heuristic/missing-tests",
  };
}

/**
 * Flag source files that gained new functions (or a meaningful amount of code) in this PR
 * without any matching test change. A source file counts as covered when a changed test
 * file shares its name (`payments.py` ↔ `test_payments.py`) or mentions a new function.
 */
export async function findTestGaps(files: FileDiff[], repo?: RepoContext): Promise<Finding[]> {
  const live = files.filter((f) => f.status !== "deleted");
  const tests = live.filter((f) => classifyFile(f.path) === "test");
  const sources = live.filter((f) => classifyFile(f.path) === "source");
  if (sources.length === 0) return [];

  const changedTestStems = new Set(tests.map((f) => testStem(f.path)));
  const changedTestText = tests.flatMap((f) => addedLines(f).map((l) => l.content)).join("\n");
  const repoTests = ((await repo?.listFiles?.()) ?? [])
    .filter((path) => classifyFile(path) === "test")
    .sort();

  const findings: Finding[] = [];
  for (const file of sources) {
    const fns = newFunctions(file);
    const meaningful = addedLines(file).filter((l) => !NOT_MEANINGFUL.test(l.content));
    if (fns.length === 0 && meaningful.length < MIN_MEANINGFUL_LINES) continue;

    const stem = sourceStem(file.path);
    if (changedTestStems.has(stem)) continue;
    const mentioned = fns.some((fn) =>
      new RegExp(`\\b${escapeRegExp(fn.name)}\\b`).test(changedTestText),
    );
    if (mentioned) continue;

    const existing = repoTests.find((path) => testStem(path) === stem);
    findings.push(toFinding(file, fns, meaningful[0]?.newLine ?? 1, existing));
  }
  return findings;
}

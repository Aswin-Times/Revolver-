import { describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import { FindingSchema } from "../../src/finding.js";
import type { RepoContext } from "../../src/repo.js";
import { findTestGaps } from "../../src/test-gap/find-gaps.js";

/** A brand-new file containing `lines`. */
const added = (path: string, lines: string[]): FileDiff =>
  parse([
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ]);

/** An existing file that gains `lines` after line 10. */
const modified = (path: string, lines: string[]): FileDiff =>
  parse([
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -10,0 +11,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ]);

const deleted = (path: string, lines: string[]): FileDiff =>
  parse([
    `--- a/${path}`,
    "+++ /dev/null",
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((l) => `-${l}`),
  ]);

function parse(lines: string[]): FileDiff {
  const [file] = parseDiff(lines.join("\n") + "\n");
  if (!file) throw new Error("bad fixture");
  return file;
}

const PAYMENTS = [
  "import math",
  "",
  "",
  "def calculate_discount(price, rate):",
  "    if rate < 0 or rate > 1:",
  '        raise ValueError("rate must be between 0 and 1")',
  "    return math.floor(price * (1 - rate))",
];

describe("findTestGaps", () => {
  it("flags a new Python function that comes with no tests", async () => {
    const [finding] = await findTestGaps([added("app/payments.py", PAYMENTS)]);
    expect(finding).toMatchObject({
      file: "app/payments.py",
      line: 4,
      category: "tests",
      severity: "medium",
      source: "heuristic",
      ruleId: "heuristic/missing-tests",
    });
    expect(finding?.title).toContain("calculate_discount");
    expect(finding?.explanation).toMatch(/edge case/i);
  });

  it("suggests a pytest skeleton that imports the new function", async () => {
    const [finding] = await findTestGaps([added("app/payments.py", PAYMENTS)]);
    expect(finding?.suggestion).toContain("tests/test_payments.py");
    expect(finding?.suggestion).toContain("from app.payments import calculate_discount");
    expect(finding?.suggestion).toContain("def test_calculate_discount");
  });

  it("suggests a describe/it skeleton next to a TypeScript file", async () => {
    const [finding] = await findTestGaps([
      added("src/utils/price.ts", [
        "export function applyDiscount(total: number, rate: number): number {",
        "  if (rate < 0) throw new Error('negative rate');",
        "  return total * (1 - rate);",
        "}",
      ]),
    ]);
    expect(finding?.suggestion).toContain("src/utils/price.test.ts");
    expect(finding?.suggestion).toContain('import { applyDiscount } from "./price";');
    expect(finding?.suggestion).toContain('describe("applyDiscount"');
  });

  it("stays quiet when the matching test file changed too", async () => {
    expect(
      await findTestGaps([
        added("app/payments.py", PAYMENTS),
        modified("tests/test_payments.py", ["def test_discount():", "    assert True"]),
      ]),
    ).toEqual([]);
    expect(
      await findTestGaps([
        added("src/utils/price.ts", [
          "export function applyDiscount(t, r) {",
          "  return t * r;",
          "}",
        ]),
        added("src/utils/__tests__/price.test.ts", ["it('works', () => {});"]),
      ]),
    ).toEqual([]);
  });

  it("stays quiet when a differently named test uses the new function", async () => {
    expect(
      await findTestGaps([
        added("app/payments.py", PAYMENTS),
        modified("tests/test_checkout_flow.py", [
          "def test_flow():",
          "    assert calculate_discount(100, 0.5) == 50",
        ]),
      ]),
    ).toEqual([]);
  });

  it("doesn't count a deleted test file as coverage", async () => {
    const findings = await findTestGaps([
      added("app/payments.py", PAYMENTS),
      deleted("tests/test_payments.py", ["def test_old():", "    assert True"]),
    ]);
    expect(findings).toHaveLength(1);
  });

  it("rates new functions in an existing file medium and other larger edits low", async () => {
    const [withFunction] = await findTestGaps([
      modified("app/cart.py", [
        "def add_item(cart, item):",
        "    cart.append(item)",
        "    return cart",
      ]),
    ]);
    expect(withFunction?.severity).toBe("medium");

    const [plainEdit] = await findTestGaps([
      modified("app/cart.py", [
        "    if not item:",
        "        return cart",
        "    if item in cart:",
        "        cart.remove(item)",
        "    cart.append(item)",
      ]),
    ]);
    expect(plainEdit).toMatchObject({ severity: "low", line: 11 });
  });

  it("ignores trivial edits: a couple of lines, comments or imports", async () => {
    expect(
      await findTestGaps([modified("app/cart.py", ["    total = 0", "    return total"])]),
    ).toEqual([]);
    expect(
      await findTestGaps([
        modified("src/index.ts", [
          'import { a } from "./a";',
          'export { b } from "./b";',
          "// A comment",
          "/* another */",
          "",
          "",
        ]),
      ]),
    ).toEqual([]);
  });

  it("ignores files that don't need unit tests", async () => {
    expect(
      await findTestGaps([
        added("README.md", ["# Docs", "def not_code():", "x", "y", "z", "w"]),
        added("vite.config.ts", ["export default function config() {", "  return {};", "}"]),
        added("app/migrations/0002_add_total.py", [
          "def forwards(apps, schema_editor):",
          "    pass",
        ]),
      ]),
    ).toEqual([]);
  });

  it("points at an existing test file that wasn't updated", async () => {
    const repo: RepoContext = {
      readFile: () => Promise.resolve(undefined),
      listFiles: () => Promise.resolve(["app/payments.py", "tests/unit/test_payments.py"]),
    };
    const [finding] = await findTestGaps([added("app/payments.py", PAYMENTS)], repo);
    expect(finding?.explanation).toContain("tests/unit/test_payments.py");
    expect(finding?.suggestion).toContain("tests/unit/test_payments.py");
  });

  it("names at most three functions in the title", async () => {
    const [finding] = await findTestGaps([
      added("app/math_utils.py", [
        "def a():",
        "    pass",
        "def b():",
        "    pass",
        "def c():",
        "    pass",
        "def d():",
        "    pass",
        "def e():",
        "    pass",
      ]),
    ]);
    expect(finding?.title).toContain("`a`, `b`, `c` and 2 more");
  });

  it("produces findings that pass the Finding schema", async () => {
    const findings = await findTestGaps([
      added("app/payments.py", PAYMENTS),
      added("src/utils/price.ts", [
        "export const applyDiscount = (t, r) => t * r;",
        "export const x = 1;",
        "export const y = 2;",
      ]),
      added("cmd/main.go", ["package main", "func Run() {", "}", "func Stop() {", "}"]),
    ]);
    expect(findings).toHaveLength(3);
    for (const finding of findings) expect(FindingSchema.safeParse(finding).success).toBe(true);
  });
});

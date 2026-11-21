import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FindingSchema } from "../../src/finding.js";
import { eslintTool } from "../../src/static/eslint.js";
import type { Workspace } from "../../src/static/workspace.js";
import { contextWith, fakeRunner, realWorkspace } from "./helpers.js";

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.dispose();
  ws = undefined;
});

/** Lint the given new files with the real ESLint and return what eslintTool reports. */
async function lint(files: Record<string, string>) {
  ws = await realWorkspace(files);
  return eslintTool.run(ws.files, contextWith(fakeRunner({}), ws));
}

const longFunction = (lines: number) =>
  [
    "export function build(rows) {",
    "  let total = 0;",
    ...Array.from({ length: lines }, (_, i) => `  total += rows[${i}];`),
    "  return total;",
    "}",
    "",
  ].join("\n");

describe("eslintTool (real ESLint)", () => {
  it("flags eval on request data as a critical security finding", async () => {
    const { findings } = await lint({
      "server/run.js": "export function run(req) {\n  return eval(req.query.code);\n}\n",
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        file: "server/run.js",
        line: 2,
        ruleId: "eslint/no-eval",
        category: "security",
        severity: "critical",
        source: "lint",
      }),
    );
  });

  it("flags an empty catch block as a swallowed error", async () => {
    const { findings } = await lint({
      "src/load.js": [
        "export function load(text) {",
        "  try {",
        "    return JSON.parse(text);",
        "  } catch (error) {",
        "  }",
        "}",
        "",
      ].join("\n"),
    });
    const finding = findings.find((f) => f.ruleId === "eslint/empty-catch");
    expect(finding).toMatchObject({ file: "src/load.js", line: 4, category: "quality" });
    expect(finding?.explanation).toMatch(/swallow|silently|hidden/i);
  });

  it("flags a very long function", async () => {
    const { findings } = await lint({ "src/report.js": longFunction(120) });
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "eslint/max-lines-per-function",
        line: 1,
        category: "quality",
        severity: "medium",
      }),
    );
  });

  it("parses TypeScript and TSX without flagging types used only in annotations", async () => {
    const { findings, detail } = await lint({
      "src/user.ts": [
        "interface User { id: string; name: string }",
        "export function greet(user: User): string {",
        "  return `Hello ${user.name}`;",
        "}",
        "",
      ].join("\n"),
      "src/Card.tsx": [
        "type Props = { title: string };",
        "export function Card({ title }: Props) {",
        "  return <h2>{title}</h2>;",
        "}",
        "",
      ].join("\n"),
    });
    expect(detail).toBeUndefined();
    expect(findings).toEqual([]);
  });

  it("doesn't flag a component that is only used in JSX as unused", async () => {
    const { findings } = await lint({
      "src/App.jsx": [
        'import Card from "./Card";',
        "export function App() {",
        '  return <Card title="Hi" />;',
        "}",
        "",
      ].join("\n"),
    });
    expect(findings).toEqual([]);
  });

  it("never loads the repo's own ESLint config (it is JavaScript from the student)", async () => {
    ws = await realWorkspace({ "src/a.js": "export const a = 1;\n" });
    const marker = join(ws.dir, "config-was-executed");
    writeFileSync(
      join(ws.root, "eslint.config.js"),
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "x");\nexport default [];\n`,
    );
    await eslintTool.run(ws.files, contextWith(fakeRunner({}), ws));
    expect(existsSync(marker)).toBe(false);
  });

  it("ignores eslint-disable comments, so they can't hide a finding", async () => {
    const { findings } = await lint({
      "src/run.js":
        "// eslint-disable-next-line no-eval\nexport const run = (code) => eval(code);\n",
    });
    expect(findings.map((f) => f.ruleId)).toContain("eslint/no-eval");
  });

  it("reports files it can't parse instead of turning them into findings", async () => {
    const { findings, detail } = await lint({ "src/broken.js": "function broken( {\n" });
    expect(findings).toEqual([]);
    expect(detail).toContain("src/broken.js");
  });

  it("produces findings that pass the Finding schema", async () => {
    const { findings } = await lint({
      "src/all.js": "export function f(a) {\n  try { return eval(a); } catch (e) {}\n}\n",
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(FindingSchema.safeParse(finding).success).toBe(true);
  });

  it("only lints complete JavaScript and TypeScript files", () => {
    const file = (path: string, partial = false) => ({ path, absPath: path, partial });
    for (const path of ["a.js", "b.jsx", "c.mjs", "d.cjs", "e.ts", "f.tsx"]) {
      expect(eslintTool.appliesTo(file(path))).toBe(true);
    }
    expect(eslintTool.appliesTo(file("a.js", true))).toBe(false);
    expect(eslintTool.appliesTo(file("a.py"))).toBe(false);
  });
});

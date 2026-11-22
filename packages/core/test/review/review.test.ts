import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { parseDiff } from "../../src/diff/parse.js";
import type { Finding } from "../../src/finding.js";
import type { RepoContext } from "../../src/repo.js";
import { verifiedRepo } from "../../src/repo/verify.js";
import { reviewDiff } from "../../src/review/review.js";
import type { StaticTool } from "../../src/static/tool.js";
import type { WorkspaceFile } from "../../src/static/workspace.js";
import { answer, emptyReview, fakeLlm } from "../llm/helpers.js";

const ROUTES = [
  "def user(db, request):",
  "    user_id = request.args['id']",
  '    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")',
];
const newFile = (path: string, lines: string[]) =>
  [
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
    "",
  ].join("\n");
const DIFF = newFile("app/routes.py", ROUTES);
const repo: RepoContext = {
  readFile: (p) => Promise.resolve(p === "app/routes.py" ? ROUTES.join("\n") + "\n" : undefined),
};

const sql: Finding = {
  file: "app/routes.py",
  line: 3,
  category: "security",
  severity: "critical",
  title: "SQL injection",
  explanation: "tool words",
  suggestion: "tool fix",
  references: [],
  confidence: 0.85,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
};

function tool(
  findings: Finding[],
  extra: { secrets?: string[]; seen?: WorkspaceFile[][] } = {},
): StaticTool {
  return {
    name: "semgrep",
    appliesTo: () => true,
    run(files) {
      extra.seen?.push(files);
      return Promise.resolve({ findings, ...(extra.secrets ? { secrets: extra.secrets } : {}) });
    },
  };
}

const base = (registry: StaticTool[]) => ({ config: DEFAULT_CONFIG, static: { registry } });

describe("reviewDiff", () => {
  it("stops early with a friendly message when the PR is too large", async () => {
    const llm = fakeLlm({});
    const result = await reviewDiff(DIFF, repo, {
      ...base([]),
      llm,
      limits: { maxChangedLines: 1 },
    });
    expect(result.status).toBe("too_large");
    expect(result.message).toMatch(/split/i);
    expect(llm.counted).toHaveLength(0);
  });

  it("says there's nothing to review when every file was filtered out", async () => {
    const result = await reviewDiff(newFile("package-lock.json", ["{}"]), repo, {
      ...base([]),
      llm: null,
    });
    expect(result.status).toBe("nothing_to_review");
    expect(result.skippedFiles).toEqual([{ path: "package-lock.json", reason: "lockfile" }]);
  });

  it("runs static checks, test gaps and Claude, then merges and ranks", async () => {
    const llm = fakeLlm({
      responses: [
        answer({
          summary: "Nice and small!",
          staticVerdicts: [
            {
              id: "S1",
              verdict: "confirm",
              why: "id is user input",
              severity: null,
              explanation: "Claude's words",
              suggestion: null,
            },
          ],
          findings: [
            {
              file: "app/routes.py",
              line: 2,
              endLine: null,
              category: "quality",
              severity: "medium",
              title: "No input validation",
              explanation: "Anything can be passed as id.",
              suggestion: "```python\nuser_id = int(request.args['id'])\n```",
              references: [],
              confidence: 0.7,
            },
          ],
        }),
      ],
    });
    const result = await reviewDiff(DIFF, repo, { ...base([tool([sql])]), llm });

    expect(result.status).toBe("ok");
    expect(result.findings.map((f) => [f.title, f.source])).toEqual([
      ["SQL injection", "semgrep"],
      ["New function `user` has no tests", "heuristic"],
      ["No input validation", "llm"],
    ]);
    expect(result.findings[0]?.explanation).toBe("Claude's words");
    expect(result.llm).toMatchObject({
      status: "ran",
      summary: "Nice and small!",
      confirmed: 1,
      added: 1,
    });
    expect(result.tools.map((t) => t.status)).toEqual(["ran"]);
  });

  it("works without Claude when the LLM pass is turned off", async () => {
    const result = await reviewDiff(DIFF, repo, { ...base([tool([sql])]), llm: null });
    expect(result.findings.map((f) => f.source)).toEqual(["semgrep", "heuristic"]);
    expect(result.llm.status).toBe("skipped");
    expect(result.llm.detail).toMatch(/turned off/i);
  });

  it("drops findings Claude rejected and reports why", async () => {
    const llm = fakeLlm({
      responses: [
        answer({
          ...emptyReview(),
          staticVerdicts: [
            {
              id: "S1",
              verdict: "reject",
              why: "Parameterised elsewhere.",
              severity: null,
              explanation: null,
              suggestion: null,
            },
          ],
        }),
      ],
    });
    const result = await reviewDiff(DIFF, repo, { ...base([tool([sql])]), llm });
    expect(result.findings.some((f) => f.ruleId === "semgrep/py-sql-injection")).toBe(false);
    expect(result.rejected).toEqual([{ finding: sql, why: "Parameterised elsewhere." }]);
  });

  it("redacts secrets the tools found before anything is sent to Claude", async () => {
    const secret = "f7Kq92LmZx4Rt8Vb1Nc6Hs3Pd0Wy5Ja";
    const diff = newFile("app/config.py", [`TOKEN = "${secret}"`]);
    const llm = fakeLlm({ responses: [answer(emptyReview())] });
    await reviewDiff(
      diff,
      { readFile: () => Promise.resolve(undefined) },
      { ...base([tool([], { secrets: [secret] })]), llm },
    );
    expect(llm.requests[0]?.user).not.toContain(secret);
  });

  it("gives tools a rebuilt partial file when the repo copy doesn't match the diff", async () => {
    const seen: WorkspaceFile[][] = [];
    const stale: RepoContext = { readFile: () => Promise.resolve("something else entirely\n") };
    await reviewDiff(DIFF, stale, { ...base([tool([], { seen })]), llm: null });
    expect(seen[0]?.[0]?.partial).toBe(true);
  });
});

describe("verifiedRepo", () => {
  const files = parseDiff(DIFF);

  it("passes through contents that match every line the diff shows (CRLF too)", async () => {
    const crlf: RepoContext = { readFile: () => Promise.resolve(ROUTES.join("\r\n") + "\r\n") };
    expect(await verifiedRepo(files, crlf).readFile("app/routes.py")).toBe(
      ROUTES.join("\r\n") + "\r\n",
    );
  });

  it("refuses contents that don't match the diff", async () => {
    const edited: RepoContext = { readFile: () => Promise.resolve(["x", ...ROUTES].join("\n")) };
    expect(await verifiedRepo(files, edited).readFile("app/routes.py")).toBeUndefined();
  });

  it("keeps listFiles from the underlying repo", async () => {
    const listed: RepoContext = { ...repo, listFiles: () => Promise.resolve(["a.py"]) };
    expect(await verifiedRepo(files, listed).listFiles?.()).toEqual(["a.py"]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import type { Finding } from "../../src/finding.js";
import { LlmUnavailableError } from "../../src/llm/client.js";
import { runLlmPass } from "../../src/llm/pass.js";
import { answer, cleanPromptScan, emptyReview, fakeLlm, usage } from "./helpers.js";

const fileDiff = (path: string, lines: string[]): FileDiff => {
  const [file] = parseDiff(
    [
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
      "",
    ].join("\n"),
  );
  if (!file) throw new Error("bad fixture");
  return file;
};

const routes = fileDiff("app/routes.py", [
  "def user(db, request):",
  "    user_id = request.args['id']",
  '    return db.execute(f"SELECT * FROM users WHERE id = {user_id}")',
]);

const sqlFinding: Finding = {
  file: "app/routes.py",
  line: 3,
  category: "security",
  severity: "critical",
  title: "SQL injection",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.85,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
};

const identity = (text: string) => text;
const run = (
  client: ReturnType<typeof fakeLlm>,
  overrides: Partial<Parameters<typeof runLlmPass>[0]> = {},
) =>
  runLlmPass({
    files: [routes],
    staticFindings: [sqlFinding],
    redact: identity,
    config: DEFAULT_CONFIG,
    client,
    promptScanner: cleanPromptScan,
    ...overrides,
  });

const llmFinding = {
  file: "app/routes.py",
  line: 2,
  endLine: null,
  category: "quality" as const,
  severity: "medium" as const,
  title: "No validation of the id",
  explanation: "Anything can be passed as id.",
  suggestion: "```python\nuser_id = int(request.args['id'])\n```",
  references: [],
  confidence: 0.7,
};

describe("runLlmPass", () => {
  it("withholds the prompt from both provider endpoints if local screening fails", async () => {
    const client = fakeLlm({});
    const result = await run(client, {
      promptScanner: async () => {
        throw new Error("private scanner error");
      },
    });
    expect(result.report).toMatchObject({
      status: "failed",
      detail: "Gitleaks could not screen the outbound prompt.",
    });
    expect(client.counted).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it("screens and blocks a potential secret on a removed line", async () => {
    const client = fakeLlm({});
    const removed = 'password = "removed test credential"';
    const files = parseDiff(
      `--- a/config.py\n+++ b/config.py\n@@ -1 +1 @@\n-${removed}\n+password = None\n`,
    );
    let screened: string | undefined;
    const result = await run(client, {
      files,
      staticFindings: [],
      promptScanner: async (command, args, options) => {
        screened = options.input;
        return { ...(await cleanPromptScan(command, args, options)), exitCode: 42 };
      },
    });
    expect(screened).toContain(removed);
    expect(result.report.detail).toMatch(/potential secret/);
    expect(client.counted).toEqual([]);
    expect(client.requests).toEqual([]);
  });
  it("returns validated verdicts and new findings, with usage, cost and counts", async () => {
    const client = fakeLlm({
      responses: [
        answer(
          {
            summary: "Good structure!",
            staticVerdicts: [
              {
                id: "S1",
                verdict: "confirm",
                why: "The id is user input.",
                severity: null,
                explanation: null,
                suggestion: null,
              },
            ],
            findings: [llmFinding],
          },
          { usage: usage(10_000, 2_000) },
        ),
      ],
    });
    const result = await run(client);

    expect(result.findings).toEqual([expect.objectContaining({ line: 2, source: "llm" })]);
    expect(result.verdicts).toEqual([
      { id: "S1", verdict: "confirm", why: "The id is user input." },
    ]);
    expect(result.staticItems.map((i) => [i.id, i.finding.ruleId])).toEqual([
      ["S1", "semgrep/py-sql-injection"],
    ]);
    expect(result.report).toMatchObject({
      status: "ran",
      model: "claude-sonnet-5-5",
      servedBy: "claude-sonnet-5-5",
      summary: "Good structure!",
      confirmed: 1,
      rejected: 0,
      added: 1,
      omittedFiles: [],
    });
    expect(result.report.costUsd).toBeCloseTo(0.04, 6);
  });

  it("sends the configured model, effort and output budget, with redacted text", async () => {
    const secret = "f7Kq92LmZx4Rt8Vb1Nc6Hs3Pd0Wy5Ja";
    const client = fakeLlm({ responses: [answer(emptyReview())] });
    await run(client, {
      files: [fileDiff("app/config.py", [`TOKEN = "${secret}"`])],
      staticFindings: [],
      redact: (text) => text.split(secret).join("****y5Ja"),
    });
    expect(client.requests[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      effort: "medium",
      maxTokens: 16_000,
    });
    expect(client.requests[0]?.user).not.toContain(secret);
    expect(client.counted[0]?.user).not.toContain(secret);
  });

  it("reports a refusal as declined without retrying", async () => {
    const client = fakeLlm({
      responses: [
        answer(emptyReview(), { stopReason: "refusal", refusalCategory: "cyber", text: "" }),
      ],
    });
    const result = await run(client);
    expect(client.requests).toHaveLength(1);
    expect(result.report.status).toBe("declined");
    expect(result.report.detail).toContain("cyber");
    expect(result.findings).toEqual([]);
  });

  it("retries a cut-off answer once at lower effort and adds up the usage", async () => {
    const client = fakeLlm({
      responses: [
        answer(emptyReview(), {
          stopReason: "max_tokens",
          text: '{"summ',
          usage: usage(1000, 16_000),
        }),
        answer(emptyReview(), { usage: usage(1000, 3000) }),
      ],
    });
    const result = await run(client);
    expect(client.requests.map((r) => r.effort)).toEqual(["medium", "low"]);
    expect(result.report.status).toBe("ran");
    expect(result.report.usage).toMatchObject({ inputTokens: 2000, outputTokens: 19_000 });
  });

  it("gives up when the answer is cut off even at low effort", async () => {
    const cutOff = answer(emptyReview(), { stopReason: "max_tokens", text: "{" });
    const client = fakeLlm({ responses: [cutOff, cutOff] });
    const result = await run(client, { config: { ...DEFAULT_CONFIG, effort: "low" } });
    expect(client.requests).toHaveLength(1);
    expect(result.report.status).toBe("failed");
    expect(result.report.detail).toMatch(/output budget/i);
  });

  it("retries once when the answer isn't valid review JSON", async () => {
    const client = fakeLlm({
      responses: [answer(emptyReview(), { text: "not json" }), answer(emptyReview())],
    });
    expect((await run(client)).report.status).toBe("ran");
    expect(client.requests).toHaveLength(2);

    const twiceBad = fakeLlm({
      responses: [
        answer(emptyReview(), { text: '{"summary": 1}' }),
        answer(emptyReview(), { text: "[]" }),
      ],
    });
    const result = await run(twiceBad);
    expect(result.report.status).toBe("failed");
    expect(twiceBad.requests).toHaveLength(2);
  });

  it.each([
    ["no-credentials", "skipped"],
    ["auth-failed", "skipped"],
    ["rate-limited", "failed"],
    ["connection", "failed"],
  ] as const)("reports an unavailable API (%s) as %s, with the reason", async (reason, status) => {
    const client = fakeLlm({ responses: [new LlmUnavailableError(`because ${reason}`, reason)] });
    const result = await run(client);
    expect(result.report.status).toBe(status);
    expect(result.report.detail).toContain(`because ${reason}`);
  });

  it("never throws on an unexpected error; the review continues without Claude", async () => {
    const client = fakeLlm({ responses: [new TypeError("boom")] });
    const result = await run(client);
    expect(result.report).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("boom") as string,
    });
  });

  it("leaves the least important files out when the prompt is over budget", async () => {
    const readme = fileDiff(
      "README.md",
      Array.from({ length: 200 }, (_, i) => `Line ${i} of docs`),
    );
    const testFile = fileDiff("tests/test_routes.py", ["def test_user():", "    assert True"]);
    const client = fakeLlm({
      responses: [answer(emptyReview())],
      // ~10 tokens per line of the user message: the README alone blows the budget.
      tokens: (request) => request.user.split("\n").length * 10,
    });
    const result = await run(client, {
      files: [routes, readme, testFile],
      staticFindings: [sqlFinding, { ...sqlFinding, file: "README.md", line: 1 }],
      config: { ...DEFAULT_CONFIG, budget: { ...DEFAULT_CONFIG.budget, maxInputTokens: 400 } },
    });
    expect(result.report.status).toBe("ran");
    expect(result.report.omittedFiles).toEqual(["README.md"]);
    expect(result.staticItems.map((i) => i.finding.file)).toEqual(["app/routes.py"]);
    expect(client.requests[0]?.user).not.toContain("Line 5 of docs");
    expect(client.requests[0]?.user).toContain("tests/test_routes.py");
  });

  it("skips Claude when not even one file fits the budget", async () => {
    const client = fakeLlm({ tokens: () => 1_000_000 });
    const result = await run(client);
    expect(result.report.status).toBe("skipped");
    expect(result.report.detail).toMatch(/budget/i);
    expect(client.requests).toHaveLength(0);
  });

  it("doesn't call the API at all when there's nothing to review", async () => {
    const client = fakeLlm({});
    const result = await run(client, { files: [] });
    expect(result.report.status).toBe("skipped");
    expect(client.counted).toHaveLength(0);
  });
});

/**
 * One real review against the Claude API (about $0.05). Skipped unless PR_MENTOR_LIVE=1,
 * so CI and normal test runs never spend money. Needs ANTHROPIC_API_KEY (or an
 * `ant auth login` profile).
 *
 *   PowerShell:  $env:PR_MENTOR_LIVE = "1"; pnpm test:integration
 *   bash:        PR_MENTOR_LIVE=1 pnpm test:integration
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createAnthropicLlmClient } from "../../src/llm/client.js";
import { reviewDiff } from "../../src/review/review.js";

const ROUTE = [
  "from flask import Flask, request",
  "import sqlite3",
  "",
  "app = Flask(__name__)",
  "",
  "",
  '@app.route("/user")',
  "def user():",
  '    conn = sqlite3.connect("app.db")',
  '    user_id = request.args["id"]',
  '    return str(conn.execute(f"SELECT * FROM users WHERE id = {user_id}").fetchone())',
];
const DIFF = [
  "--- /dev/null",
  "+++ b/app/routes.py",
  `@@ -0,0 +1,${ROUTE.length} @@`,
  ...ROUTE.map((l) => `+${l}`),
  "",
].join("\n");

describe.skipIf(process.env.PR_MENTOR_LIVE !== "1")("live Claude review", () => {
  it(
    "finds the SQL injection, within budget, with usage and cost reported",
    { timeout: 300_000 },
    async () => {
      const result = await reviewDiff(
        DIFF,
        {
          readFile: (p) =>
            Promise.resolve(p === "app/routes.py" ? ROUTE.join("\n") + "\n" : undefined),
        },
        {
          config: loadConfig(process.env),
          llm: createAnthropicLlmClient(),
          static: { registry: [] },
        },
      );

      expect(result.llm.status, result.llm.detail).toBe("ran");
      expect(result.llm.usage.inputTokens + result.llm.usage.cacheReadTokens).toBeGreaterThan(0);
      expect(result.llm.costUsd ?? 1).toBeLessThan(0.25);
      expect(result.findings).toContainEqual(
        expect.objectContaining({ file: "app/routes.py", category: "security", source: "llm" }),
      );
    },
  );
});

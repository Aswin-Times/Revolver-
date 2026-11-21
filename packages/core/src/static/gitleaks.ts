import { posix } from "node:path";
import { z } from "zod";
import type { Finding, Reference } from "../finding.js";
import { redactSecret } from "../redact.js";
import { runTool, ToolError, type StaticTool } from "./tool.js";

const LeakSchema = z.object({
  RuleID: z.string().min(1),
  StartLine: z.number().int().positive(),
  EndLine: z.number().int().positive(),
  Match: z.string(),
  Secret: z.string().min(1),
  File: z.string().min(1),
});
type Leak = z.infer<typeof LeakSchema>;

const NAMES: Record<string, string> = {
  "aws-access-token": "AWS access key",
  "generic-api-key": "secret (an API key, token or password)",
  "github-pat": "GitHub personal access token",
  "github-fine-grained-pat": "GitHub access token",
  "gcp-api-key": "Google Cloud API key",
  "openai-api-key": "OpenAI API key",
  "anthropic-api-key": "Anthropic API key",
  "slack-bot-token": "Slack bot token",
  "stripe-access-token": "Stripe API key",
  "private-key": "private key",
  jwt: "JSON Web Token",
};

/** Entropy-based rules: more false positives, so lower severity and confidence. */
const FUZZY_RULES = new Set(["generic-api-key"]);

const REFERENCES: Reference[] = [
  {
    title: "OWASP Secrets Management Cheat Sheet",
    url: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
  },
  {
    title: "GitHub Docs: Removing sensitive data from a repository",
    url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository",
  },
];

/**
 * The variable the secret was assigned to (`API_TOKEN = "..."` → `API_TOKEN`). Only the
 * text *before* the secret is searched, so the identifier can never contain the secret.
 */
function identifierFor(leak: Leak): string | undefined {
  const at = leak.Match.indexOf(leak.Secret);
  if (at === -1) return undefined;
  const before = leak.Match.slice(0, at);
  return /([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*["']?$/.exec(before)?.[1];
}

const toEnvName = (identifier: string) =>
  identifier.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

function suggestionFor(file: string, leak: Leak): string {
  const identifier = identifierFor(leak);
  const envName = identifier
    ? toEnvName(identifier)
    : leak.RuleID === "aws-access-token"
      ? "AWS_ACCESS_KEY_ID"
      : "API_KEY";
  const variable = identifier ?? envName.toLowerCase();
  const base = posix.basename(file);
  const ext = posix.extname(file);

  if (base === ".env" || base.startsWith(".env.")) {
    return [
      "Keep real values out of git:",
      "",
      "1. Add `.env` to `.gitignore`.",
      `2. Stop tracking it: \`git rm --cached ${file}\``,
      `3. Commit a \`.env.example\` with placeholders (e.g. \`${envName}=changeme\`) so others know which settings exist.`,
    ].join("\n");
  }
  if (ext === ".py") {
    return ["```python", "import os", "", `${variable} = os.environ["${envName}"]`, "```"].join(
      "\n",
    );
  }
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) {
    return ["```js", `const ${variable} = process.env.${envName};`, "```"].join("\n");
  }
  return `Move the value into an environment variable (for example \`${envName}\`) or your platform's secret store, and read it at runtime.`;
}

function toFinding(leak: Leak, file: string): Finding {
  const name = NAMES[leak.RuleID] ?? leak.RuleID.replace(/-/g, " ");
  const article = /^[aeiou]/i.test(name) ? "an" : "a";
  const fuzzy = FUZZY_RULES.has(leak.RuleID);
  const explanation = [
    `This line contains what looks like ${article} ${name} (\`${redactSecret(leak.Secret)}\`).`,
    "Anything committed to git stays in the history even after you delete it, and bots scan public repositories for keys within minutes.",
    "Treat it as leaked: revoke or rotate it with the provider now, then read it from an environment variable so it never lives in the code.",
    ...(fuzzy
      ? ["If this isn't really a secret (say, a dummy test value), you can ignore this comment."]
      : []),
  ].join(" ");

  return {
    file,
    line: leak.StartLine,
    ...(leak.EndLine > leak.StartLine ? { endLine: leak.EndLine } : {}),
    category: "security",
    severity: fuzzy ? "high" : "critical",
    title: `Hardcoded ${name}`,
    explanation,
    suggestion: suggestionFor(file, leak),
    references: REFERENCES,
    confidence: fuzzy ? 0.7 : 0.95,
    source: "gitleaks",
    ruleId: `gitleaks/${leak.RuleID}`,
  };
}

/** Parse a Gitleaks JSON report. Raw secrets never leave this function. */
export function parseGitleaksReport(
  json: string,
  toRepoPath: (toolPath: string) => string | undefined,
): Finding[] {
  if (json.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ToolError("gitleaks printed something that isn't JSON");
  }
  const parsed = z.array(LeakSchema).safeParse(data);
  if (!parsed.success) throw new ToolError("gitleaks printed JSON in an unexpected shape");

  return parsed.data.flatMap((leak) => {
    const file = toRepoPath(leak.File);
    return file ? [toFinding(leak, file)] : [];
  });
}

export const gitleaksTool: StaticTool = {
  name: "gitleaks",
  appliesTo: () => true,
  async run(_files, ctx) {
    const result = await runTool(ctx, "gitleaks", [
      "dir",
      ctx.workspace.root,
      "--report-format",
      "json",
      "--report-path",
      "-",
      "--no-banner",
      "--exit-code",
      "0",
      "--log-level",
      "error",
      "--max-target-megabytes",
      "5",
    ]);
    return { findings: parseGitleaksReport(result.stdout, ctx.workspace.toRepoPath) };
  },
};

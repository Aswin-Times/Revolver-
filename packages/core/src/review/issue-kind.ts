/**
 * What kind of problem a tool rule reports, so two tools flagging the same issue (e.g.
 * Ruff S608 on the string and Semgrep on the execute() call a line later) can be recognised
 * as one. Rules not listed here are never merged by proximity, only by overlapping lines.
 */
const KINDS: Record<string, string[]> = {
  "sql-injection": ["ruff/S608", "semgrep/py-sql-injection", "semgrep/js-sql-injection"],
  "command-injection": [
    "ruff/S602",
    "ruff/S605",
    "semgrep/py-command-injection",
    "semgrep/js-command-injection",
  ],
  "code-eval": [
    "ruff/S307",
    "ruff/S102",
    "semgrep/py-eval-exec",
    "semgrep/js-eval",
    "eslint/no-eval",
    "eslint/no-implied-eval",
    "eslint/no-new-func",
  ],
  deserialization: [
    "ruff/S301",
    "ruff/S506",
    "semgrep/py-unsafe-deserialization",
    "semgrep/js-unsafe-deserialization",
  ],
  "hardcoded-secret": [
    "ruff/S105",
    "ruff/S106",
    "ruff/S107",
    "semgrep/py-hardcoded-jwt-secret",
    "semgrep/js-hardcoded-jwt-secret",
  ],
  "tls-disabled": [
    "ruff/S501",
    "semgrep/py-requests-verify-disabled",
    "semgrep/js-tls-verification-disabled",
  ],
  "swallowed-error": ["ruff/E722", "ruff/S110", "ruff/S112", "ruff/BLE001", "eslint/empty-catch"],
  "big-function": [
    "ruff/C901",
    "ruff/PLR0912",
    "ruff/PLR0915",
    "eslint/complexity",
    "eslint/max-lines-per-function",
  ],
};

const KIND_OF = new Map(
  Object.entries(KINDS).flatMap(([kind, rules]) => rules.map((rule) => [rule, kind] as const)),
);

export function issueKind(ruleId: string | undefined): string | undefined {
  if (!ruleId) return undefined;
  if (ruleId.startsWith("gitleaks/")) return "hardcoded-secret";
  return KIND_OF.get(ruleId);
}

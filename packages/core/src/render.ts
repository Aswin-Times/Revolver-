import type { Finding, Severity } from "./finding.js";
import type { LlmReport } from "./llm/pass.js";
import type { ReviewResult } from "./review/review.js";
import type { ToolName } from "./static/tool.js";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const BADGE: Record<Severity, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
const CATEGORY_LABEL = { security: "Security", tests: "Tests", quality: "Quality" } as const;
const TOOL_LABEL: Record<ToolName, string> = {
  gitleaks: "Gitleaks",
  semgrep: "Semgrep",
  ruff: "Ruff",
  eslint: "ESLint",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, noun: string) =>
  `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
/** File paths come from the diff; a backtick would break the inline code. */
const location = (f: Finding) =>
  `\`${f.file.replace(/`/g, "'")}:${f.line}${f.endLine ? `-${f.endLine}` : ""}\``;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function foundBy(f: Finding): string {
  switch (f.source) {
    case "heuristic":
      return "the missing-tests check";
    case "llm":
      return "Claude";
    case "lint": {
      const tool = f.ruleId?.startsWith("ruff/")
        ? "Ruff"
        : f.ruleId?.startsWith("eslint/")
          ? "ESLint"
          : "a linter";
      return f.ruleId ? `${tool} (\`${f.ruleId}\`)` : tool;
    }
    default: {
      const tool = TOOL_LABEL[f.source];
      return f.ruleId ? `${tool} (\`${f.ruleId}\`)` : tool;
    }
  }
}

const shortFoundBy = (f: Finding) => foundBy(f).replace(/ \(`[^`]*`\)$/, "");

export function renderFinding(f: Finding): string {
  const parts = [
    `## ${BADGE[f.severity]} ${capitalize(f.severity)} · ${CATEGORY_LABEL[f.category]}: ${f.title}`,
    `${location(f)} · found by ${foundBy(f)}`,
    f.explanation,
    "**Suggested fix**",
    f.suggestion,
  ];
  if (f.references.length > 0) {
    parts.push(`Learn more: ${f.references.map((r) => `[${r.title}](${r.url})`).join(" · ")}`);
  }
  return parts.join("\n\n");
}

const tokens = (llm: LlmReport) =>
  `${llm.usage.inputTokens.toLocaleString("en-US")} in / ${llm.usage.outputTokens.toLocaleString("en-US")} out / ${llm.usage.cacheReadTokens.toLocaleString("en-US")} cached tokens`;
const cost = (llm: LlmReport) =>
  llm.costUsd === undefined ? "cost unknown" : `$${llm.costUsd.toFixed(4)}`;

function howItWasMade(result: ReviewResult): string {
  const rows = result.tools.map(
    (t) => `| ${TOOL_LABEL[t.tool]} | ${t.status} | ${t.findings} | ${cell(t.detail ?? "")} |`,
  );
  const llm = result.llm;
  const claudeName = `Claude (${llm.servedBy ?? llm.model})`;
  rows.push(
    llm.status === "ran"
      ? `| ${claudeName} | ran | ${llm.confirmed} confirmed, ${llm.rejected} rejected, ${llm.added} added | ${tokens(llm)} · ${cost(llm)} |`
      : `| ${claudeName} | ${llm.status} | – | ${cell(llm.detail ?? "")} |`,
  );
  const lines = [
    "## How this review was made",
    "",
    "| Check | Status | Findings | Notes |",
    "| --- | --- | --- | --- |",
    ...rows,
  ];
  if (llm.omittedFiles.length > 0) {
    lines.push(
      "",
      `Claude didn't see (token budget): ${llm.omittedFiles.map((p) => `\`${p}\``).join(", ")}`,
    );
  }
  if (result.skippedFiles.length > 0) {
    lines.push(
      "",
      `Not reviewed: ${result.skippedFiles.map((s) => `\`${s.path}\` (${s.reason})`).join(", ")}`,
    );
  }
  if (result.notScanned.length > 0) {
    lines.push(
      "",
      `Not given to the static tools: ${result.notScanned.map((s) => `\`${s.path}\` (${s.reason})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** The human report: summary, ranked findings, held-back findings, and how it was made. */
export function renderMarkdown(result: ReviewResult): string {
  const sections = ["# PR Mentor review"];
  if (result.status !== "ok") {
    sections.push(result.message ?? "Nothing to review.", howItWasMade(result));
    return sections.join("\n\n") + "\n";
  }

  if (result.llm.summary) sections.push(result.llm.summary);
  const all = [...result.findings, ...result.hidden];
  if (all.length === 0) {
    sections.push("No issues found. Nice work! 🎉");
  } else {
    const bySeverity = SEVERITY_ORDER.flatMap((s) => {
      const n = all.filter((f) => f.severity === s).length;
      return n > 0 ? [`${BADGE[s]} ${n} ${s}`] : [];
    });
    sections.push(`**${count(all.length, "finding")}**: ${bySeverity.join(" · ")}`);
  }

  sections.push(...result.findings.map(renderFinding));

  if (result.hidden.length > 0) {
    const items = result.hidden.map(
      (f) => `- ${BADGE[f.severity]} ${f.title} (${location(f)}, found by ${shortFoundBy(f)})`,
    );
    sections.push(
      `<details><summary>${count(result.hidden.length, "more finding")}</summary>\n\n${items.join("\n")}\n\n</details>`,
    );
  }
  if (result.rejected.length > 0) {
    const items = result.rejected.map(
      (r) => `- ${r.finding.title} (${location(r.finding)}): ${r.why}`,
    );
    sections.push(
      `<details><summary>${count(result.rejected.length, "tool finding")} Claude dismissed</summary>\n\n${items.join("\n")}\n\n</details>`,
    );
  }

  sections.push(howItWasMade(result));
  return sections.join("\n\n") + "\n";
}

/** One log line for stderr: model, tokens, cost and time. */
export function usageLine(llm: LlmReport, durationMs: number): string {
  const seconds = `${(durationMs / 1000).toFixed(1)}s`;
  if (llm.status !== "ran" && llm.usage.inputTokens === 0) {
    return `pr-mentor: Claude ${llm.status} · ${seconds}`;
  }
  return `pr-mentor: ${llm.servedBy ?? llm.model} · ${tokens(llm)} · ${cost(llm)} · ${seconds}`;
}

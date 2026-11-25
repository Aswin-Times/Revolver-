export const severities = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof severities)[number];

interface Finding {
  title: string;
  severity: Severity;
  category: string;
  file: string;
  line: number;
  explanation: string;
  suggestion: string;
  ruleId?: string;
}

const statuses = ["ok", "too_large", "nothing_to_review"] as const;
type Status = (typeof statuses)[number];

export interface Review {
  id: string;
  title: string;
  repository: string;
  date: string;
  status: Status;
  message: string;
  findings: Finding[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && list.some((item) => item === value);

function isFinding(value: unknown): value is Finding {
  return (
    object(value) &&
    includes(severities, value.severity) &&
    includes(["security", "tests", "quality"], value.category) &&
    typeof value.title === "string" &&
    typeof value.file === "string" &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    typeof value.explanation === "string" &&
    typeof value.suggestion === "string" &&
    (value.ruleId === undefined || typeof value.ruleId === "string")
  );
}

const isFindings = (value: unknown): value is Finding[] =>
  Array.isArray(value) && value.every(isFinding);

export function parseReport(
  text: string,
  metadata: Pick<Review, "id" | "title" | "repository" | "date">,
): Review {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (
    !object(value) ||
    !includes(statuses, value.status) ||
    !object(value.stats) ||
    typeof value.stats.files !== "number" ||
    !isFindings(value.findings) ||
    !isFindings(value.hidden)
  ) {
    throw new Error("Choose a PR Mentor CLI report exported with --format json.");
  }
  const findings = [...value.findings, ...value.hidden].map(
    ({ title, severity, category, file, line, explanation, suggestion, ruleId }) => ({
      title,
      severity,
      category,
      file,
      line,
      explanation,
      suggestion,
      ruleId,
    }),
  );
  return {
    ...metadata,
    status: value.status,
    message: typeof value.message === "string" ? value.message : "",
    findings,
  };
}

export function storedReviews(text: string | null): Review[] | undefined {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (
      Array.isArray(value) &&
      value.every(
        (item): item is Review =>
          object(item) &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.repository === "string" &&
          typeof item.date === "string" &&
          Number.isFinite(Date.parse(item.date)) &&
          includes(statuses, item.status) &&
          typeof item.message === "string" &&
          isFindings(item.findings),
      )
    )
      return value;
  } catch {
    return undefined;
  }
}

export function summarize(reviews: Review[]) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const byIssue = new Map<string, { title: string; reviews: number }>();
  for (const review of reviews) {
    const seen = new Set<string>();
    for (const finding of review.findings) {
      counts[finding.severity]++;
      const key = finding.ruleId || `${finding.category}:${finding.title.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const issue = byIssue.get(key) ?? { title: finding.title, reviews: 0 };
      issue.reviews++;
      byIssue.set(key, issue);
    }
  }
  return {
    counts,
    total: severities.reduce((total, severity) => total + counts[severity], 0),
    repositories: new Set(reviews.map((review) => review.repository).filter(Boolean)).size,
    recurring: [...byIssue.values()]
      .filter((issue) => issue.reviews > 1)
      .sort((a, b) => b.reviews - a.reviews || a.title.localeCompare(b.title))
      .slice(0, 5),
  };
}

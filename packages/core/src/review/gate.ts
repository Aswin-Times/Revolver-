import { SeveritySchema, type Severity } from "../finding.js";
import type { ReviewResult } from "./review.js";

export function reviewGateFailure(result: ReviewResult, threshold: Severity): string | undefined {
  const severities = SeveritySchema.options;
  const atThreshold = (severity: Severity) =>
    severities.indexOf(severity) <= severities.indexOf(threshold);
  if ([...result.findings, ...result.hidden].some((finding) => atThreshold(finding.severity))) {
    return `PR Mentor found issues at or above "${threshold}" severity.`;
  }
  if (result.status === "too_large") {
    return "PR Mentor could not complete the review because the diff exceeded its limits.";
  }
  const unavailableTools = result.tools.filter(
    (tool) => tool.status === "failed" || tool.incomplete,
  );
  if (unavailableTools.length > 0) {
    return `PR Mentor could not complete the review. Incomplete checks: ${unavailableTools.map((tool) => tool.tool).join(", ")}.`;
  }
  if (result.notScanned.some((file) => file.reason !== "tool-config")) {
    return "PR Mentor could not scan every eligible changed file.";
  }
}

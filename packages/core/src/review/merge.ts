import type { Finding } from "../finding.js";
import type { StaticItem } from "../llm/prompt.js";
import type { ValidVerdict } from "../llm/validate.js";

export interface MergeInput {
  /** Every static and test-gap finding, including ones Claude never saw. */
  staticFindings: Finding[];
  /** The findings Claude saw, with the ids its verdicts refer to. */
  staticItems: StaticItem[];
  verdicts: ValidVerdict[];
  llmFindings: Finding[];
}

export interface MergeResult {
  findings: Finding[];
  rejected: { finding: Finding; why: string }[];
}

/** Confirmation from Claude raises a tool finding's confidence, up to this cap. */
const CONFIRMED_BOOST = 0.1;
const CONFIRMED_CAP = 0.95;

/**
 * Apply Claude's verdicts to the static findings: confirmed ones may get a better
 * severity, explanation or fix (keeping the tool as source); rejected ones are dropped;
 * ones Claude didn't mention, or never saw, are kept as the tools reported them.
 */
export function mergeFindings(input: MergeInput): MergeResult {
  const byId = new Map(input.verdicts.map((v) => [v.id, v]));
  const verdictFor = new Map<Finding, ValidVerdict>();
  for (const item of input.staticItems) {
    const verdict = byId.get(item.id);
    if (verdict) verdictFor.set(item.finding, verdict);
  }

  const findings: Finding[] = [];
  const rejected: MergeResult["rejected"] = [];
  for (const finding of input.staticFindings) {
    const verdict = verdictFor.get(finding);
    if (!verdict) {
      findings.push(finding);
    } else if (verdict.verdict === "reject") {
      rejected.push({ finding, why: verdict.why });
    } else {
      findings.push({
        ...finding,
        ...(verdict.severity ? { severity: verdict.severity } : {}),
        ...(verdict.explanation ? { explanation: verdict.explanation } : {}),
        ...(verdict.suggestion ? { suggestion: verdict.suggestion } : {}),
        confidence: Math.min(CONFIRMED_CAP, finding.confidence + CONFIRMED_BOOST),
      });
    }
  }
  return { findings: [...findings, ...input.llmFindings], rejected };
}

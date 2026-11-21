import { z } from "zod";
import { CategorySchema, SeveritySchema } from "../finding.js";

/*
 * What Claude must return, enforced through structured outputs. Every field is required
 * (nullable where it can be absent), and ranges/lengths are deliberately NOT in the
 * schema: validate.ts clamps and trims per item, so one slightly-off value can't throw
 * away an otherwise good review.
 */

export const LlmFindingSchema = z.object({
  file: z.string().describe("Repo-relative path exactly as it appears in the diff."),
  line: z.number().int().describe("New-side line number shown in the diff."),
  endLine: z.number().int().nullable().describe("Last line of a multi-line issue, or null."),
  category: CategorySchema,
  severity: SeveritySchema,
  title: z.string().describe("Short summary, under 100 characters."),
  explanation: z.string().describe("Why this matters, written for a student."),
  suggestion: z.string().describe("A small fix, as Markdown with a fenced code block."),
  references: z
    .array(z.object({ title: z.string(), url: z.string() }))
    .describe("Up to 3 links to official docs or OWASP."),
  confidence: z.number().describe("0 to 1: how sure you are this is a real problem."),
});
export type LlmFinding = z.infer<typeof LlmFindingSchema>;

export const StaticVerdictSchema = z.object({
  id: z.string().describe("The id of a static finding, e.g. S3."),
  verdict: z.enum(["confirm", "reject"]),
  why: z.string().describe("One sentence on why, citing the code."),
  severity: SeveritySchema.nullable().describe("A corrected severity, or null to keep it."),
  explanation: z.string().nullable().describe("A clearer student explanation, or null."),
  suggestion: z.string().nullable().describe("A better fix for this code, or null."),
});
export type StaticVerdict = z.infer<typeof StaticVerdictSchema>;

export const LlmReviewSchema = z.object({
  summary: z.string().describe("Two or three encouraging sentences summarising the review."),
  staticVerdicts: z.array(StaticVerdictSchema),
  findings: z.array(LlmFindingSchema).describe("Issues the tools missed."),
});
export type LlmReview = z.infer<typeof LlmReviewSchema>;

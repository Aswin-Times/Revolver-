import { z } from "zod";

export const CategorySchema = z.enum(["security", "tests", "quality"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export const SourceSchema = z.enum(["semgrep", "gitleaks", "lint", "heuristic", "llm"]);

/**
 * A link a student can follow to learn more. Only https URLs are allowed: findings can
 * come from the LLM, and a hostile diff could try to steer it into emitting a
 * `javascript:` or phishing link that we would then post on the PR.
 */
export const ReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
});

export const FindingSchema = z
  .object({
    /** Repo-relative path, as it appears on the new side of the diff. */
    file: z.string().min(1),
    /** Line number on the new side of the diff (1-based). */
    line: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    category: CategorySchema,
    severity: SeveritySchema,
    title: z.string().min(1).max(120),
    /** Why this matters, written for a student. */
    explanation: z.string().min(1),
    /** A small fix snippet or concrete next step. */
    suggestion: z.string().min(1),
    references: z.array(ReferenceSchema),
    confidence: z.number().min(0).max(1),
    source: SourceSchema,
    /** Tool rule that produced the finding, e.g. `ruff/S608`. Used for dedupe and LLM review. */
    ruleId: z.string().min(1).optional(),
  })
  .refine((f) => f.endLine === undefined || f.endLine >= f.line, {
    message: "endLine must be greater than or equal to line",
    path: ["endLine"],
  });

export type Category = z.infer<typeof CategorySchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type Finding = z.infer<typeof FindingSchema>;

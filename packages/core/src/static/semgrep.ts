import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CategorySchema, ReferenceSchema, SeveritySchema, type Finding } from "../finding.js";
import { runTool, ToolError, type StaticTool } from "./tool.js";

/** Our own ruleset, shipped with the package (src/ and dist/ both sit two levels below). */
export const SEMGREP_RULES_DIR = fileURLToPath(new URL("../../rules/semgrep", import.meta.url));

/** Student-facing metadata every one of our rules must carry. */
export const RuleMetadataSchema = z.object({
  category: CategorySchema,
  severity: SeveritySchema,
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  title: z.string().min(1).max(120),
  explanation: z.string().min(1),
  suggestion: z.string().min(1),
  references: z.array(ReferenceSchema).min(1),
});

const CONFIDENCE = { HIGH: 0.85, MEDIUM: 0.7, LOW: 0.5 } as const;

const OutputSchema = z.object({
  results: z.array(
    z.object({
      check_id: z.string(),
      path: z.string(),
      start: z.object({ line: z.number().int().positive() }),
      end: z.object({ line: z.number().int().positive() }),
      extra: z.object({ message: z.string(), metadata: z.unknown().optional() }),
    }),
  ),
  errors: z.array(z.object({ path: z.string().optional() })).default([]),
});
type Result = z.infer<typeof OutputSchema>["results"][number];

function toFinding(result: Result, file: string): Finding {
  // Semgrep prefixes rule ids with the config path ("C.Temp...rules.semgrep.py-sql-injection").
  const ruleId = result.check_id.split(".").at(-1) ?? result.check_id;
  const span =
    result.end.line > result.start.line
      ? { line: result.start.line, endLine: result.end.line }
      : { line: result.start.line };
  const meta = RuleMetadataSchema.safeParse(result.extra.metadata);

  if (!meta.success) {
    return {
      file,
      ...span,
      category: "security",
      severity: "medium",
      title: result.extra.message.slice(0, 120),
      explanation: result.extra.message,
      suggestion: "Review this line carefully and check how the values in it are used.",
      references: [],
      confidence: 0.5,
      source: "semgrep",
      ruleId: `semgrep/${ruleId}`,
    };
  }

  const { confidence, ...rest } = meta.data;
  return {
    file,
    ...span,
    ...rest,
    confidence: CONFIDENCE[confidence],
    source: "semgrep",
    ruleId: `semgrep/${ruleId}`,
  };
}

export function parseSemgrepOutput(
  json: string,
  toRepoPath: (toolPath: string) => string | undefined,
): { findings: Finding[]; unparsable: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ToolError("semgrep printed something that isn't JSON");
  }
  const parsed = OutputSchema.safeParse(data);
  if (!parsed.success) throw new ToolError("semgrep printed JSON in an unexpected shape");

  const findings = parsed.data.results.flatMap((result) => {
    const file = toRepoPath(result.path);
    return file ? [toFinding(result, file)] : [];
  });
  const unparsable = [
    ...new Set(
      parsed.data.errors.flatMap((error) => {
        const file = error.path ? toRepoPath(error.path) : undefined;
        return file ? [file] : [];
      }),
    ),
  ];
  return { findings, unparsable };
}

const SCANNED = /\.(py|js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

export const semgrepTool: StaticTool = {
  name: "semgrep",
  appliesTo: (file) => !file.partial && SCANNED.test(file.path),
  async run(files, ctx) {
    const result = await runTool(ctx, "semgrep", [
      "scan",
      "--config",
      SEMGREP_RULES_DIR,
      "--json",
      "--quiet",
      "--metrics=off",
      "--disable-version-check",
      "--timeout",
      "30",
      "--",
      ...files.map((f) => f.absPath),
    ]);
    const { findings, unparsable } = parseSemgrepOutput(result.stdout, ctx.workspace.toRepoPath);
    return {
      findings,
      ...(unparsable.length > 0
        ? { detail: `couldn't parse ${unparsable.join(", ")}, so they were only partly checked` }
        : {}),
    };
  },
};

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { CategorySchema, isSafeRepoPath, type RepoContext } from "@pr-mentor/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const LinesSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => end >= start, { message: "end line must be >= start line" });

export const ExpectedSchema = z.object({
  file: z.string().min(1),
  lines: LinesSchema,
  category: CategorySchema,
  /** Why this is a real problem: makes labels reviewable. */
  why: z.string().min(1),
});
export type Expected = z.infer<typeof ExpectedSchema>;

/** A real issue a reviewer may reasonably raise; counted neither for nor against. */
export const AllowedSchema = z.object({
  file: z.string().min(1),
  category: CategorySchema,
  lines: LinesSchema.optional(),
});
export type Allowed = z.infer<typeof AllowedSchema>;

export const CaseMetaSchema = z
  .object({
    title: z.string().min(1),
    tags: z.array(z.string()),
    /** Where the labels came from (eval hygiene: model-written gold rewards imitation). */
    groundTruth: z.enum(["human-written", "human-verified", "model-written"]),
    clean: z.boolean().default(false),
    expected: z.array(ExpectedSchema),
    allowed: z.array(AllowedSchema).default([]),
  })
  .refine((m) => !m.clean || m.expected.length === 0, {
    message: "a clean case can't expect findings",
  });
export type CaseMeta = z.infer<typeof CaseMetaSchema>;

/**
 * Secrets the fixtures need, assembled at runtime so nothing real-looking is ever
 * committed (GitHub push protection would block it).
 */
export const PLACEHOLDERS: Record<string, string> = {
  AWS_ACCESS_KEY_ID: ["AKIA", "QYLPMN5H", "HHFQZOXK"].join(""),
};

export const fillPlaceholders = (text: string) =>
  text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name: string) => PLACEHOLDERS[name] ?? match);

export interface EvalCase {
  id: string;
  dir: string;
  meta: CaseMeta;
  diff: string;
  repo: RepoContext;
}

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]),
    ),
  );
  return nested.flat();
}

/** The repo after the PR, read from the case's after/ folder. */
function afterRepo(dir: string): RepoContext {
  const after = join(dir, "after");
  return {
    async readFile(path) {
      if (!isSafeRepoPath(path)) return undefined;
      try {
        return fillPlaceholders(await readFile(join(after, ...path.split("/")), "utf8"));
      } catch {
        return undefined;
      }
    },
    async listFiles() {
      return (await walk(after)).map((p) => relative(after, p).split(sep).join("/"));
    },
  };
}

export async function loadCase(dir: string): Promise<EvalCase> {
  const id = basename(dir);
  const parsed = CaseMetaSchema.safeParse(
    parseYaml(await readFile(join(dir, "case.yaml"), "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `Case "${id}" has an invalid case.yaml: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const diff = fillPlaceholders(await readFile(join(dir, "pr.diff"), "utf8"));
  return { id, dir, meta: parsed.data, diff, repo: afterRepo(dir) };
}

export async function loadCases(root: string, ids?: string[]): Promise<EvalCase[]> {
  const entries = await readdir(root);
  const dirs: string[] = [];
  for (const name of entries.sort()) {
    if (ids && !ids.includes(name)) continue;
    if ((await stat(join(root, name))).isDirectory()) dirs.push(join(root, name));
  }
  return Promise.all(dirs.map(loadCase));
}

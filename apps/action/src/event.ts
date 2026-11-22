import { z } from "zod";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
  /** PRs from forks get a read-only token and no secrets, so we can't comment on them. */
  fromFork: boolean;
}

export class EventError extends Error {
  override name = "EventError";
}

const PayloadSchema = z.object({
  pull_request: z.object({
    number: z.number().int().positive(),
    base: z.object({ sha: z.string().min(1) }),
    head: z.object({
      sha: z.string().min(1),
      repo: z.object({ full_name: z.string() }).nullable(),
    }),
  }),
  repository: z.object({
    name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
    full_name: z.string().min(1),
  }),
});

export function prFromEvent(eventName: string, payload: unknown): PrRef {
  if (eventName === "pull_request_target") {
    throw new EventError(
      "pull_request_target isn't supported: it gives the workflow write access and secrets while handling untrusted fork code. Use `on: pull_request`.",
    );
  }
  if (eventName !== "pull_request") {
    throw new EventError(
      `PR Mentor reviews pull requests; this run was triggered by "${eventName}".`,
    );
  }
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success)
    throw new EventError("The pull_request event payload is missing fields PR Mentor needs.");
  const { pull_request: pr, repository } = parsed.data;
  return {
    owner: repository.owner.login,
    repo: repository.name,
    number: pr.number,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    fromFork: pr.head.repo?.full_name !== repository.full_name,
  };
}

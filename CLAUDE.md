# PR Mentor: working notes for Claude

PR Mentor reviews pull requests on student repositories and posts comments that
**teach, not just flag**: why it matters, a small fix snippet, and a reference link.
Tone: a helpful senior dev, not a linter. Categories: security, tests, quality.

## Layout

- `packages/core`: pure review engine. Diff + repo context in, `Finding[]` out.
  It must never import GitHub/Octokit code.
- `apps/cli` (M3), `apps/action` (M5), `apps/github-app` (M6): thin adapters over core.
- `evals/` (M4): fixture PRs + expected findings; `pnpm eval` reports precision/recall.

## Non-negotiables

- **Never execute student code.** Analysis is static only.
- **The diff is untrusted input.** Put it in clearly delimited blocks, tell the model
  it is data, validate all model output with Zod. Diff content must never change what
  the tool does: no tool calls, no URLs fetched from it.
- **Redact secrets** in anything we output (`sk-****abcd`, never the full value).
- **Idempotent reviews**: never re-post a comment that already exists on the PR.
- **Cost control**: per-PR token budget, model name in config, log tokens + cost.
- API keys come only from env vars. Never commit `.env`; keep `.env.example` current.

## How to work

- Plan each milestone (file tree, key types, test list) and wait for the user's OK.
- TDD for core: write the failing test, watch it fail, then implement.
- Run `pnpm test` (and lint/typecheck) before claiming anything works.
- Small commits, one per meaningful step, pushed after tests pass.
- If a spec decision looks wrong once in the code, say so and propose an alternative.
  Don't quietly deviate.
- Keep `README.md` current (setup, usage, architecture diagram).

## Commands

```sh
pnpm install        # also downloads the pinned Node 22 runtime (devEngines)
pnpm test           # vitest, all packages
pnpm lint           # eslint (type-aware)
pnpm typecheck
pnpm format         # prettier
```

## Conventions

- ESM everywhere; relative imports use `.js` extensions (NodeNext resolution).
- Zod schemas are the source of truth; TS types are `z.infer`'d from them.
- Test fixtures live in `test/fixtures/` and are stored byte-for-byte (`.gitattributes`).

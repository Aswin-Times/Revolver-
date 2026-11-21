# PR Mentor

An AI code-review assistant for student repositories. It reviews pull requests for
**security issues**, **missing tests** and **code quality**, and every comment teaches:
why the issue matters, a small fix, and a link to learn more.

> Status: early development (Milestone 1: core diff handling).

## Setup

Requires [pnpm](https://pnpm.io) 12+. `pnpm install` downloads the pinned Node 22
runtime for this project automatically, so your system Node version doesn't matter.

```sh
pnpm install
pnpm test
```

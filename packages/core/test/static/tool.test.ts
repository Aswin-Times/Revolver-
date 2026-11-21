import { describe, expect, it } from "vitest";
import { ToolNotFoundError } from "../../src/static/exec.js";
import { runTool, ToolError } from "../../src/static/tool.js";
import { contextWith, fakeRunner } from "./helpers.js";

describe("runTool", () => {
  it("returns the result when the tool exits with an accepted code", async () => {
    const result = await runTool(contextWith(fakeRunner({ stdout: "[]" })), "gitleaks", ["dir"]);
    expect(result.stdout).toBe("[]");
  });

  it("accepts extra exit codes the caller allows", async () => {
    const ctx = contextWith(fakeRunner({ exitCode: 1, stdout: "[]" }));
    await expect(runTool(ctx, "ruff", ["check"], [0, 1])).resolves.toMatchObject({ exitCode: 1 });
  });

  it("throws ToolError with the exit code and first stderr line on failure", async () => {
    const ctx = contextWith(fakeRunner({ exitCode: 2, stderr: "error: bad flag\nmore detail" }));
    const run = runTool(ctx, "ruff", ["check"]);
    await expect(run).rejects.toBeInstanceOf(ToolError);
    await expect(run).rejects.toThrow(/code 2.*error: bad flag/);
  });

  it("throws ToolError when the tool timed out", async () => {
    const ctx = contextWith(fakeRunner({ exitCode: null, timedOut: true }));
    await expect(runTool(ctx, "semgrep", ["scan"])).rejects.toThrow(/timed out/);
  });

  it("throws ToolError when output was truncated, since it can't be parsed reliably", async () => {
    const ctx = contextWith(fakeRunner({ truncated: true }));
    await expect(runTool(ctx, "semgrep", ["scan"])).rejects.toBeInstanceOf(ToolError);
  });

  it("lets ToolNotFoundError through so the tool can be reported as skipped", async () => {
    const missing = Object.assign(() => Promise.reject(new ToolNotFoundError("gitleaks")), {
      calls: [],
    });
    await expect(runTool(contextWith(missing), "gitleaks", ["dir"])).rejects.toBeInstanceOf(
      ToolNotFoundError,
    );
  });
});

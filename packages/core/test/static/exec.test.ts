import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand, ToolNotFoundError } from "../../src/static/exec.js";

const node = process.execPath;
const cwd = mkdtempSync(join(tmpdir(), "pr-mentor-exec-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const opts = { cwd, timeoutMs: 10_000 };

describe("runCommand", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const result = await runCommand(
      node,
      ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      opts,
    );
    expect(result).toMatchObject({ stdout: "out", stderr: "err", exitCode: 3, timedOut: false });
  });

  it("passes arguments verbatim, with no shell to interpret them", async () => {
    const hostile = ["; echo pwned", "$(whoami)", "a & b | c", '"quoted"', "%PATH%", "*.py"];
    const result = await runCommand(
      node,
      ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...hostile],
      opts,
    );
    expect(JSON.parse(result.stdout)).toEqual(hostile);
  });

  it("runs in the requested working directory", async () => {
    const result = await runCommand(node, ["-e", "process.stdout.write(process.cwd())"], opts);
    expect(realpathSync(result.stdout)).toBe(realpathSync(cwd));
  });

  it("kills a command that runs past its timeout", async () => {
    const started = Date.now();
    const result = await runCommand(node, ["-e", "setTimeout(() => {}, 20000)"], {
      cwd,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("rejects with ToolNotFoundError when the program does not exist", async () => {
    const run = runCommand("pr-mentor-no-such-tool-xyz", ["--version"], opts);
    await expect(run).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(run).rejects.toMatchObject({ command: "pr-mentor-no-such-tool-xyz" });
  });

  it("stops collecting output at the size cap and says it truncated", async () => {
    const result = await runCommand(node, ["-e", "process.stdout.write('x'.repeat(200000))"], {
      ...opts,
      maxOutputBytes: 1000,
    });
    expect(result.stdout).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });
});

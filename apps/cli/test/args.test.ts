import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, UsageError } from "../src/args.js";

const cwd = resolve("/work/student-repo");

describe("parseCliArgs", () => {
  it("parses a --base review with defaults", () => {
    expect(parseCliArgs(["review", "--base", "main"], cwd)).toEqual({
      command: "review",
      base: "main",
      repo: cwd,
      format: "markdown",
      llm: true,
    });
  });

  it("parses every review option", () => {
    expect(
      parseCliArgs(
        [
          "review",
          "--diff",
          "pr.diff",
          "--repo",
          "../other",
          "--format",
          "json",
          "--out",
          "report.json",
          "--no-llm",
          "--model",
          "claude-opus-5-5",
          "--effort",
          "high",
          "--max-comments",
          "5",
          "--fail-on",
          "high",
          "--env-file",
          "secrets.env",
        ],
        cwd,
      ),
    ).toEqual({
      command: "review",
      diffFile: resolve(cwd, "pr.diff"),
      repo: resolve(cwd, "../other"),
      format: "json",
      out: resolve(cwd, "report.json"),
      llm: false,
      model: "claude-opus-5-5",
      effort: "high",
      maxComments: 5,
      failOn: "high",
      envFile: resolve(cwd, "secrets.env"),
    });
  });

  it("shows help for --help, -h or no arguments", () => {
    expect(parseCliArgs(["--help"], cwd)).toEqual({ command: "help" });
    expect(parseCliArgs(["review", "-h"], cwd)).toEqual({ command: "help" });
    expect(parseCliArgs([], cwd)).toEqual({ command: "help" });
  });

  it.each([
    [["review"], /--diff or --base/],
    [["review", "--diff", "a", "--base", "main"], /not both/],
    [["lint"], /unknown command/i],
    [["review", "--base", "main", "--format", "html"], /--format/],
    [["review", "--base", "main", "--effort", "extreme"], /--effort/],
    [["review", "--base", "main", "--fail-on", "blocker"], /--fail-on/],
    [["review", "--base", "main", "--max-comments", "0"], /--max-comments/],
    [["review", "--base", "main", "--bogus"], /bogus/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv, cwd)).toThrow(UsageError);
    expect(() => parseCliArgs(argv, cwd)).toThrow(message);
  });
});

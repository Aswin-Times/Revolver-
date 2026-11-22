import type { Finding } from "@pr-mentor/core";
import { describe, expect, it } from "vitest";
import { EventError, prFromEvent } from "../src/event.js";
import {
  fingerprint,
  isSummary,
  marker,
  readFingerprint,
  SUMMARY_MARKER,
} from "../src/fingerprint.js";

const payload = (headRepo = "class/alice-shop") => ({
  pull_request: {
    number: 7,
    base: { sha: "aaa111" },
    head: { sha: "bbb222", repo: { full_name: headRepo } },
  },
  repository: { name: "alice-shop", owner: { login: "class" }, full_name: "class/alice-shop" },
});

describe("prFromEvent", () => {
  it("reads the PR from a pull_request event", () => {
    expect(prFromEvent("pull_request", payload())).toEqual({
      owner: "class",
      repo: "alice-shop",
      number: 7,
      baseSha: "aaa111",
      headSha: "bbb222",
      fromFork: false,
    });
  });

  it("notices PRs from forks, which get a read-only token", () => {
    expect(prFromEvent("pull_request", payload("bob/alice-shop")).fromFork).toBe(true);
  });

  it("refuses other events, explaining why pull_request_target isn't supported", () => {
    expect(() => prFromEvent("push", {})).toThrow(EventError);
    expect(() => prFromEvent("pull_request_target", payload())).toThrow(/untrusted/);
  });

  it("refuses a malformed payload", () => {
    expect(() => prFromEvent("pull_request", { pull_request: { number: "x" } })).toThrow(
      EventError,
    );
  });
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  file: "app/users.py",
  line: 12,
  category: "security",
  severity: "critical",
  title: "SQL injection",
  explanation: "e",
  suggestion: "s",
  references: [],
  confidence: 0.9,
  source: "semgrep",
  ruleId: "semgrep/py-sql-injection",
  ...overrides,
});
const code = "    row = conn.execute(f\"SELECT * FROM users WHERE name = '{name}'\").fetchone()";

describe("fingerprint", () => {
  it("doesn't change when the code moves to another line or its indentation changes", () => {
    expect(fingerprint(finding({ line: 40 }), `\t${code.trim()}  `)).toBe(
      fingerprint(finding(), code),
    );
  });

  it("changes when the flagged code, the rule or the file changes", () => {
    const base = fingerprint(finding(), code);
    expect(fingerprint(finding(), code.replace("name", "email"))).not.toBe(base);
    expect(fingerprint(finding({ ruleId: "ruff/S608" }), code)).not.toBe(base);
    expect(fingerprint(finding({ file: "app/other.py" }), code)).not.toBe(base);
  });

  it("ignores how Claude worded the title, which varies between runs", () => {
    const llm = (title: string) => finding({ source: "llm", ruleId: undefined, title });
    expect(fingerprint(llm("SQL injection"), code)).toBe(
      fingerprint(llm("Possible SQL injection risk"), code),
    );
  });
});

describe("markers", () => {
  it("round-trips a fingerprint through a comment body", () => {
    const body = `Some comment\n\n${marker("abc123def4567890")}`;
    expect(readFingerprint(body)).toBe("abc123def4567890");
    expect(readFingerprint("a comment someone else wrote")).toBeUndefined();
  });

  it("recognises our summary comment", () => {
    expect(isSummary(`# PR Mentor review\n${SUMMARY_MARKER}`)).toBe(true);
    expect(isSummary("LGTM")).toBe(false);
  });
});

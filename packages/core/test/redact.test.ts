import { describe, expect, it } from "vitest";
import { redactSecret } from "../src/redact.js";

describe("redactSecret", () => {
  it.each([
    ["Anthropic key", "sk-ant-api03-" + "a".repeat(36) + "wxyz", "sk-ant-****wxyz"],
    ["OpenAI project key", "sk-proj-" + "b".repeat(40) + "9Q2k", "sk-proj-****9Q2k"],
    ["AWS access key id", "AKIAQ3EGRLMNOPQ7XYZ1", "AKIA****XYZ1"],
    ["GitHub token", "ghp_" + "c".repeat(32) + "Zz09", "ghp_****Zz09"],
    ["Slack bot token", "xoxb-1234567890-" + "d".repeat(20), "xoxb-****dddd"],
  ])("keeps the non-secret prefix and last 4 characters of a %s", (_kind, secret, expected) => {
    expect(redactSecret(secret)).toBe(expected);
  });

  it("keeps only the last 4 characters of a long secret with no known prefix", () => {
    expect(redactSecret("9f86d081884c7d659a2feaa0c55ad015")).toBe("****d015");
  });

  it("fully masks secrets shorter than 16 characters", () => {
    expect(redactSecret("hunter2")).toBe("****");
    expect(redactSecret("SuperSecret123!")).toBe("****"); // 15 characters
  });

  it("starts revealing the last 4 characters at exactly 16 characters", () => {
    expect(redactSecret("SuperSecret1234!")).toBe("****234!");
  });

  it("fully masks a known prefix when too little secret would remain hidden", () => {
    // "sk-" plus only 13 more characters: revealing prefix + last 4 would leave 9 hidden.
    expect(redactSecret("sk-abcdefghijklm")).toBe("****jklm");
  });
});

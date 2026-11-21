import { describe, expect, it } from "vitest";
import {
  createRedactor,
  redactKnownSecrets,
  redactSecret,
  redactSecretPatterns,
} from "../src/redact.js";

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

describe("redactKnownSecrets", () => {
  const secret = "f7Kq92LmZx4Rt8Vb1Nc6Hs3Pd0Wy5Ja";

  it("replaces every occurrence of a known secret and leaves other text alone", () => {
    const text = `API_TOKEN = "${secret}"\n# again: ${secret}\nname = "demo"`;
    expect(redactKnownSecrets(text, [secret])).toBe(
      `API_TOKEN = "****y5Ja"\n# again: ****y5Ja\nname = "demo"`,
    );
  });

  it("handles a secret that contains another one without leaving fragments", () => {
    const short = "Zx4Rt8Vb1Nc6Hs3Pd0Wy";
    const out = redactKnownSecrets(`a=${secret} b=${short}`, [short, secret]);
    expect(out).not.toContain(short);
    expect(out).not.toContain("f7Kq92Lm");
  });
});

describe("redactSecretPatterns", () => {
  const awsKey = ["AKIA", "QYLPMN5H", "HHFQZOXK"].join("");
  const anthropicKey = "sk-ant-api03-" + "Ab1".repeat(14);
  const githubToken = "ghp_" + "a1B2".repeat(9);
  const slackToken = "xoxb-" + "1234567890-" + "abcdefghij".repeat(2);

  it.each([
    ["an AWS access key id", awsKey],
    ["an Anthropic key", anthropicKey],
    ["a GitHub token", githubToken],
    ["a Slack token", slackToken],
  ])("redacts %s even when Gitleaks didn't run", (_kind, value) => {
    const out = redactSecretPatterns(`config = "${value}"`);
    expect(out).not.toContain(value);
    expect(out).toContain("****");
  });

  it("redacts private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----";
    expect(redactSecretPatterns(`key = """${pem}"""`)).toBe('key = """[redacted private key]"""');
  });

  it("leaves ordinary code, words and git SHAs alone", () => {
    const text =
      "skill-level = 3\ntask-ant-colony()\ncommit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b\n";
    expect(redactSecretPatterns(text)).toBe(text);
  });

  it("is safe to apply twice", () => {
    const once = redactSecretPatterns(`k = "${awsKey}"`);
    expect(redactSecretPatterns(once)).toBe(once);
  });
});

describe("createRedactor", () => {
  it("combines known secrets with the pattern backstop", () => {
    const redact = createRedactor(["hunter2-but-much-longer-0000"]);
    const awsKey = ["AKIA", "QYLPMN5H", "HHFQZOXK"].join("");
    const out = redact(`pw = "hunter2-but-much-longer-0000"; key = "${awsKey}"`);
    expect(out).not.toContain("hunter2-but-much-longer-0000");
    expect(out).not.toContain(awsKey);
  });
});

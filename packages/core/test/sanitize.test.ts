import { describe, expect, it } from "vitest";
import { isAllowedReferenceUrl, sanitizeReferences, sanitizeText } from "../src/sanitize.js";

describe("sanitizeText", () => {
  it("neutralizes @mentions in prose so a comment can never ping someone", () => {
    expect(sanitizeText("Ask @octocat or @org/team about this.", 500)).toBe(
      "Ask `@octocat` or `@org/team` about this.",
    );
  });

  it("leaves @ alone inside code and in email addresses", () => {
    const text =
      "Use `@app.route` like this:\n```python\n@app.route('/x')\n```\nMail me@example.com";
    expect(sanitizeText(text, 500)).toBe(text);
  });

  it("escapes raw HTML in prose but not inside code blocks", () => {
    // The URL is code-quoted too: GitHub would otherwise autolink it in the escaped text.
    expect(sanitizeText('Hi <img src="https://evil.test/p.png"> there', 500)).toBe(
      'Hi &lt;img src="`https://evil.test/p.png`"> there',
    );
    const code = '```html\n<div class="x"></div>\n```';
    expect(sanitizeText(code, 500)).toBe(code);
  });

  it("removes markdown images, which could be tracking pixels", () => {
    expect(sanitizeText("See ![chart](https://evil.test/pixel.gif) above", 500)).toBe(
      "See chart above",
    );
  });

  it("keeps links to trusted docs and turns other links into plain text", () => {
    expect(
      sanitizeText(
        "Read [OWASP](https://owasp.org/Top10/) and [this](https://evil.test/phish).",
        500,
      ),
    ).toBe("Read [OWASP](https://owasp.org/Top10/) and this.");
  });

  it("stops untrusted bare URLs from becoming clickable", () => {
    expect(sanitizeText("Go to https://evil.test/login now", 500)).toBe(
      "Go to `https://evil.test/login` now",
    );
    expect(sanitizeText("Docs: https://docs.python.org/3/", 500)).toBe(
      "Docs: https://docs.python.org/3/",
    );
  });

  it("truncates long text and closes a code fence it cut open", () => {
    const text = "Intro\n```python\n" + "x = 1\n".repeat(50) + "```";
    const out = sanitizeText(text, 60);
    expect(out.length).toBeLessThanOrEqual(70);
    expect(out.match(/```/g)).toHaveLength(2);
  });

  it("strips control characters", () => {
    expect(sanitizeText("ok\u0000\u0007 fine\tstill\nhere", 500)).toBe("ok fine\tstill\nhere");
  });
});

describe("isAllowedReferenceUrl", () => {
  it.each([
    "https://owasp.org/www-community/attacks/SQL_Injection",
    "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
    "https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML",
    "https://docs.python.org/3/library/sqlite3.html",
    "https://docs.astral.sh/ruff/rules/hardcoded-sql-expression/",
  ])("allows %s", (url) => {
    expect(isAllowedReferenceUrl(url)).toBe(true);
  });

  it.each([
    "http://owasp.org/",
    "https://evil-owasp.org/",
    "https://owasp.org.evil.test/",
    "https://user:pw@owasp.org/",
    "javascript:alert(1)",
    "https://bit.ly/abc",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isAllowedReferenceUrl(url)).toBe(false);
  });
});

describe("sanitizeReferences", () => {
  it("keeps at most three allowed references with plain-text titles", () => {
    const refs = sanitizeReferences([
      { title: "Evil", url: "https://evil.test/" },
      { title: "OWASP <b>SQLi</b>", url: "https://owasp.org/a" },
      { title: "MDN", url: "https://developer.mozilla.org/b" },
      { title: "Python", url: "https://docs.python.org/c" },
      { title: "Node", url: "https://nodejs.org/d" },
    ]);
    expect(refs).toEqual([
      { title: "OWASP SQLi", url: "https://owasp.org/a" },
      { title: "MDN", url: "https://developer.mozilla.org/b" },
      { title: "Python", url: "https://docs.python.org/c" },
    ]);
  });
});

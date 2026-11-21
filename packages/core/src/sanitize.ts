import type { Reference } from "./finding.js";

/**
 * Sites a review comment may link to. Model output can be steered by a hostile diff, so
 * links anywhere else (phishing pages, tracking pixels, URL shorteners, user-hosted
 * content such as github.com repos) are removed. Subdomains are allowed.
 */
export const REFERENCE_DOMAINS = [
  "owasp.org",
  "cwe.mitre.org",
  "developer.mozilla.org",
  "docs.python.org",
  "peps.python.org",
  "nodejs.org",
  "docs.astral.sh",
  "eslint.org",
  "typescript-eslint.io",
  "typescriptlang.org",
  "semgrep.dev",
  "react.dev",
  "nextjs.org",
  "expressjs.com",
  "flask.palletsprojects.com",
  "docs.djangoproject.com",
  "fastapi.tiangolo.com",
  "docs.sqlalchemy.org",
  "requests.readthedocs.io",
  "docs.pytest.org",
  "vitest.dev",
  "jestjs.io",
  "docs.npmjs.com",
  "go.dev",
  "doc.rust-lang.org",
  "docs.oracle.com",
  "learn.microsoft.com",
  "docs.github.com",
  "martinfowler.com",
];

export function isAllowedReferenceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return REFERENCE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CODE = /(```[\s\S]*?```|`[^`\n]+`)/g;
const MENTION = /(^|[^\w`])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9_.-]+)?)/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const BARE_URL = /(?<![(\w])https?:\/\/[^\s)<>`"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

const neutralizeMentions = (text: string) => text.replace(MENTION, "$1`@$2`");

function sanitizeProse(text: string): string {
  let out = text.replace(IMAGE, "$1");
  out = out.replace(LINK, (match, label: string, url: string) =>
    isAllowedReferenceUrl(url) ? match : label,
  );
  out = out.replace(/</g, "&lt;");
  out = out.replace(BARE_URL, (match) => {
    const trailing = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
    const url = match.slice(0, match.length - trailing.length);
    return (isAllowedReferenceUrl(url) ? url : `\`${url}\``) + trailing;
  });
  return neutralizeMentions(out);
}

/**
 * Make model-written Markdown safe to show in a PR comment: no @mentions that would ping
 * people, no raw HTML, no images (tracking pixels), no links outside REFERENCE_DOMAINS,
 * no control characters. Code spans and code blocks are left exactly as written.
 */
export function sanitizeText(text: string, maxLength: number): string {
  let out = text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength - 1)}…`;
    if ((out.match(/```/g)?.length ?? 0) % 2 === 1) out += "\n```";
  }
  return out
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : sanitizeProse(part)))
    .join("")
    .trim();
}

/** For one-line fields such as titles: plain text, single spaces, no tags or mentions. */
export function sanitizePlain(text: string, maxLength: number): string {
  const out = text
    .replace(CONTROL_CHARS, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
  return neutralizeMentions(clipped);
}

/** Up to three references on allowed sites, with plain-text titles. */
export function sanitizeReferences(references: { title: string; url: string }[]): Reference[] {
  return references
    .filter((ref) => isAllowedReferenceUrl(ref.url))
    .slice(0, 3)
    .map((ref) => ({
      title: sanitizePlain(ref.title, 100) || new URL(ref.url).hostname,
      url: ref.url,
    }));
}

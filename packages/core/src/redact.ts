/**
 * Well-known key prefixes. They identify the kind of key (useful to a student) but carry
 * no secret entropy, so showing them is safe. Keep longer prefixes before shorter ones
 * they start with, so `sk-ant-` wins over `sk-`.
 */
const KNOWN_PREFIXES = [
  "github_pat_",
  "sk_live_",
  "sk_test_",
  "rk_live_",
  "pk_live_",
  "sk-proj-",
  "sk-ant-",
  "glpat-",
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "ghp_",
  "gho_",
  "ghs_",
  "ghu_",
  "npm_",
  "AKIA",
  "ASIA",
  "AIza",
  "SG.",
  "sk-",
];

/** Never reveal anything unless at least this many characters stay hidden. */
const MIN_HIDDEN = 12;
const VISIBLE_SUFFIX = 4;
const MASK = "****";

/**
 * Redact a secret for display: `sk-ant-****wxyz`, `AKIA****XYZ1`, `****d015` or `****`.
 * Use this on every secret before it goes into a finding, a log line or a PR comment.
 */
export function redactSecret(secret: string): string {
  const suffix = secret.slice(-VISIBLE_SUFFIX);
  const prefix = KNOWN_PREFIXES.find((p) => secret.startsWith(p));

  if (prefix && secret.length - prefix.length - VISIBLE_SUFFIX >= MIN_HIDDEN) {
    return prefix + MASK + suffix;
  }
  if (secret.length - VISIBLE_SUFFIX >= MIN_HIDDEN) return MASK + suffix;
  return MASK;
}

/**
 * Replace every occurrence of known secret values (e.g. what Gitleaks found) with their
 * redacted form. Longest first, so a secret containing another leaves no fragments.
 */
export function redactKnownSecrets(text: string, secrets: Iterable<string>): string {
  const unique = [...new Set(secrets)]
    .filter((secret) => secret.length >= 6)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of unique) out = out.split(secret).join(redactSecret(secret));
  return out;
}

/** Well-known key formats, as a backstop for when Gitleaks isn't installed. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA)[A-Z2-7]{16}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g,
];
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactSecretPatterns(text: string): string {
  let out = text.replace(PRIVATE_KEY, "[redacted private key]");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, (match) => redactSecret(match));
  return out;
}

/**
 * A function that redacts the given known secrets plus well-known key formats. Being a
 * closure, it keeps the raw values private and is dropped by JSON.stringify.
 */
export function createRedactor(secrets: Iterable<string>): (text: string) => string {
  const known = [...secrets];
  return (text) => redactSecretPatterns(redactKnownSecrets(text, known));
}

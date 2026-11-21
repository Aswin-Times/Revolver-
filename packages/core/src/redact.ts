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

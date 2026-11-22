import { parseEnv } from "node:util";

const ALLOWED = (key: string) => key === "ANTHROPIC_API_KEY" || key.startsWith("PR_MENTOR_");

/**
 * Apply an env file passed with --env-file. Only ANTHROPIC_API_KEY and PR_MENTOR_* are
 * read, and values already set win. We never load a .env implicitly: in a student's repo
 * it could set ANTHROPIC_BASE_URL and capture the reviewer's API key.
 */
export function applyEnvFile(content: string, env: Record<string, string | undefined>): string[] {
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(content))) {
    if (!ALLOWED(key) || env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

import { posix } from "node:path";

export type FileKind = "test" | "source" | "ignored";

const CODE =
  /\.(py|js|jsx|mjs|cjs|ts|tsx|mts|cts|java|kt|go|rb|rs|c|cc|cpp|h|hpp|cs|php|swift|scala)$/;

const TEST_FILE = [
  /^test_.*\.py$/,
  /_test\.py$/,
  /^conftest\.py$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /Tests?\.(java|kt|cs)$/,
  /_test\.go$/,
  /_(spec|test)\.rb$/,
];
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|e2e|cypress)\//;

/** Code that rarely has (or needs) unit tests of its own. */
const NO_TESTS_NEEDED_NAMES = new Set([
  "setup.py",
  "manage.py",
  "__init__.py",
  "wsgi.py",
  "asgi.py",
]);
const NO_TESTS_NEEDED = [
  /(^|\/)migrations\//,
  /(^|\/)alembic\/versions\//,
  /\.d\.[cm]?ts$/,
  /\.stories\.[cm]?[jt]sx?$/,
  /(^|\/)[^/]+\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc\.[cm]?js$/,
];

export function classifyFile(path: string): FileKind {
  const base = posix.basename(path);
  if (!CODE.test(base)) return "ignored";
  if (TEST_FILE.some((pattern) => pattern.test(base)) || TEST_DIR.test(path)) return "test";
  if (NO_TESTS_NEEDED_NAMES.has(base) || NO_TESTS_NEEDED.some((p) => p.test(path))) {
    return "ignored";
  }
  return "source";
}

/** Lowercase letters and digits only, so `user-service` and `userService` compare equal. */
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const withoutExtension = (path: string) => posix.basename(path, posix.extname(path));

/** `index.ts` and `__init__.py` are named after their folder (`src/cart/index.ts` → cart). */
function folderNameIfIndex(name: string, path: string): string {
  return name === "index" || name === "__init__" ? posix.basename(posix.dirname(path)) : name;
}

/** The name a source file's tests are usually named after: `app/payments.py` → payments. */
export function sourceStem(path: string): string {
  return normalize(folderNameIfIndex(withoutExtension(path), path));
}

/** The source name a test file covers: `tests/test_payments.py` → payments. */
export function testStem(path: string): string {
  const name = withoutExtension(path)
    .replace(/\.(test|spec)$/i, "")
    .replace(/^test_/i, "")
    .replace(/_(test|spec)$/i, "")
    .replace(/Tests?$/, "");
  return normalize(folderNameIfIndex(name, path));
}

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const roots = ["packages/*/test", "apps/*/test"];

export default defineConfig({
  resolve: {
    // Apps import the core package straight from source, so tests never need a build first.
    alias: {
      "@pr-mentor/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: roots.map((r) => `${r}/**/*.test.ts`),
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        // Runs the real Semgrep, Gitleaks and Ruff binaries; slow, especially on Windows.
        extends: true,
        test: {
          name: "integration",
          include: roots.map((r) => `${r}/**/*.integration.test.ts`),
          testTimeout: 240_000,
        },
      },
    ],
  },
});

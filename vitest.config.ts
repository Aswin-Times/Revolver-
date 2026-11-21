import { defineConfig } from "vitest/config";

const roots = ["packages/*/test", "apps/*/test"];

export default defineConfig({
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

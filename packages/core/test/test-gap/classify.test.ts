import { describe, expect, it } from "vitest";
import { classifyFile, sourceStem, testStem } from "../../src/test-gap/classify.js";

describe("classifyFile", () => {
  it.each([
    "tests/test_payments.py",
    "app/payments_test.py",
    "test/helpers.py",
    "conftest.py",
    "src/price.test.ts",
    "src/price.spec.js",
    "src/__tests__/price.ts",
    "web/Button.test.tsx",
    "src/test/java/com/shop/PriceTest.java",
    "pkg/price_test.go",
    "spec/models/user_spec.rb",
  ])("recognises %s as a test file", (path) => {
    expect(classifyFile(path)).toBe("test");
  });

  it.each([
    "app/payments.py",
    "src/utils/price.ts",
    "web/Button.tsx",
    "server/index.js",
    "cmd/server/main.go",
    "app/models/user.rb",
    "src/main/java/com/shop/Price.java",
  ])("recognises %s as source code", (path) => {
    expect(classifyFile(path)).toBe("source");
  });

  it.each([
    "README.md",
    "package.json",
    "config.yml",
    "styles/site.css",
    "templates/index.html",
    "vite.config.ts",
    "jest.config.js",
    "setup.py",
    "manage.py",
    "app/__init__.py",
    "app/migrations/0001_initial.py",
    "alembic/versions/3f2a_add_users.py",
    "src/types.d.ts",
    "src/Button.stories.tsx",
    ".github/workflows/ci.yml",
  ])("ignores %s (nothing to unit test)", (path) => {
    expect(classifyFile(path)).toBe("ignored");
  });
});

describe("stems used to match source files with their tests", () => {
  it.each([
    ["app/payments.py", "payments"],
    ["src/utils/price.ts", "price"],
    ["src/cart/index.ts", "cart"],
    ["src/user-service.ts", "userservice"],
    ["web/Button.tsx", "button"],
  ])("source %s → %s", (path, stem) => {
    expect(sourceStem(path)).toBe(stem);
  });

  it.each([
    ["tests/test_payments.py", "payments"],
    ["app/payments_test.py", "payments"],
    ["src/price.test.ts", "price"],
    ["src/price.spec.js", "price"],
    ["src/__tests__/price.tsx", "price"],
    ["src/__tests__/cart/index.test.ts", "cart"],
    ["src/userService.test.ts", "userservice"],
    ["src/test/java/com/shop/PriceTest.java", "price"],
    ["pkg/price_test.go", "price"],
    ["spec/models/user_spec.rb", "user"],
  ])("test %s → %s", (path, stem) => {
    expect(testStem(path)).toBe(stem);
  });
});

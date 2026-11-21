import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import type { FileDiff } from "../../src/diff/types.js";
import type { RepoContext } from "../../src/repo.js";
import { createWorkspace, type Workspace } from "../../src/static/workspace.js";

/** A modified file whose diff adds `lines` at the top; enough for the workspace. */
const changed = (path: string, lines = ["x = 1"]): FileDiff => {
  const [file] = parseDiff(
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
      "",
    ].join("\n"),
  );
  if (!file) throw new Error("fixture diff did not parse");
  return { ...file, path };
};

const repoOf = (files: Record<string, string>): RepoContext => ({
  readFile: (path) => Promise.resolve(files[path]),
});

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.dispose();
  ws = undefined;
});

describe("createWorkspace", () => {
  it("writes the post-change contents of each file at its repo path", async () => {
    ws = await createWorkspace(
      [changed("app/routes.py"), changed("src/ui/App.tsx")],
      repoOf({ "app/routes.py": "import os\n", "src/ui/App.tsx": "export const App = 1;\n" }),
    );
    expect(readFileSync(join(ws.root, "app/routes.py"), "utf8")).toBe("import os\n");
    expect(readFileSync(join(ws.root, "src/ui/App.tsx"), "utf8")).toBe("export const App = 1;\n");
    expect(ws.files.map((f) => [f.path, f.partial])).toEqual([
      ["app/routes.py", false],
      ["src/ui/App.tsx", false],
    ]);
  });

  it("rebuilds a partial file from the diff when the full contents are unavailable", async () => {
    const [file] = parseDiff(
      [
        "--- a/app/config.py",
        "+++ b/app/config.py",
        "@@ -2,1 +2,3 @@",
        " DEBUG = False",
        '+API_KEY = "abc"',
        "+TIMEOUT = 5",
        "",
      ].join("\n"),
    );
    ws = await createWorkspace([file!], repoOf({}));
    expect(readFileSync(join(ws.root, "app/config.py"), "utf8")).toBe(
      '\nDEBUG = False\nAPI_KEY = "abc"\nTIMEOUT = 5\n',
    );
    expect(ws.files).toEqual([expect.objectContaining({ path: "app/config.py", partial: true })]);
  });

  it.each([
    "../escape.py",
    "../../etc/passwd",
    "/etc/passwd",
    "C:/Windows/evil.py",
    "C:evil.py",
    "a/../../b.py",
    "src\\..\\..\\evil.py",
    "a//b.py",
    "./a.py",
    "bad\u0000name.py",
  ])("refuses the unsafe path %j and writes nothing for it", async (path) => {
    ws = await createWorkspace([changed(path)], repoOf({ [path]: "pwned = True\n" }));
    expect(ws.files).toEqual([]);
    expect(ws.skipped).toEqual([{ path, reason: "unsafe-path" }]);
    expect(readdirSync(ws.root)).toEqual([]);
    expect(existsSync(resolve(ws.root, "..", "escape.py"))).toBe(false);
  });

  it("leaves out tool config files but still writes other dotfiles such as .env", async () => {
    const paths = [
      ".gitleaks.toml",
      "sub/.gitleaksignore",
      ".semgrepignore",
      "ruff.toml",
      "pyproject.toml",
      "eslint.config.js",
      "web/.eslintrc.json",
      ".env",
    ];
    ws = await createWorkspace(
      paths.map((p) => changed(p)),
      repoOf(Object.fromEntries(paths.map((p) => [p, "x\n"]))),
    );
    expect(ws.files.map((f) => f.path)).toEqual([".env"]);
    expect(ws.skipped.map((s) => s.reason)).toEqual(Array(7).fill("tool-config"));
  });

  it("maps paths reported by tools back to repo paths", async () => {
    ws = await createWorkspace([changed("app/routes.py")], repoOf({ "app/routes.py": "x\n" }));
    expect(ws.toRepoPath(join(ws.root, "app", "routes.py"))).toBe("app/routes.py");
    expect(ws.toRepoPath("app/routes.py")).toBe("app/routes.py");
    expect(ws.toRepoPath(join(ws.root, "app", "other.py"))).toBeUndefined();
    expect(ws.toRepoPath(join(ws.root, "..", "outside.py"))).toBeUndefined();
  });

  it("maps a differently spelled temp path (e.g. macOS /private/var) by its suffix", async () => {
    ws = await createWorkspace([changed("app/routes.py")], repoOf({ "app/routes.py": "x\n" }));
    expect(ws.toRepoPath("/private/var/folders/xy/pr-mentor-abc/repo/app/routes.py")).toBe(
      "app/routes.py",
    );
  });

  it.runIf(process.platform === "win32")(
    "matches tool paths case-insensitively on Windows",
    async () => {
      ws = await createWorkspace([changed("app/routes.py")], repoOf({ "app/routes.py": "x\n" }));
      expect(ws.toRepoPath(join(ws.root.toUpperCase(), "APP", "Routes.py"))).toBe("app/routes.py");
    },
  );

  it("deletes everything on dispose", async () => {
    const created = await createWorkspace([changed("a.py")], repoOf({ "a.py": "x\n" }));
    await created.dispose();
    expect(existsSync(created.dir)).toBe(false);
  });
});

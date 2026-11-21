import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
import type { Category, Finding, Reference, Severity } from "../finding.js";
import type { StaticTool } from "./tool.js";

const JS_FILES = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

/** The only selector we restrict; reported under our own id. */
const EMPTY_CATCH = "CatchClause > BlockStatement[body.length=0]";

const RULES: Linter.RulesRecord = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-restricted-syntax": ["warn", { selector: EMPTY_CATCH, message: "Empty catch block." }],
  "@typescript-eslint/no-unused-vars": [
    "warn",
    { args: "none", caughtErrors: "none", ignoreRestSiblings: true },
  ],
  "no-unreachable": "warn",
  complexity: ["warn", 10],
  "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
  "max-depth": ["warn", 4],
  "max-params": ["warn", 5],
  "no-useless-catch": "warn",
  eqeqeq: ["warn", "smart"],
  "no-debugger": "warn",
};

/**
 * Our bundled config. The typescript-eslint parser handles plain JS too and tracks JSX
 * references, so components used only in JSX aren't reported as unused. No type info is
 * used, so we never need the student's tsconfig.json or node_modules.
 */
const CONFIG: Linter.Config[] = [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tseslint.plugin as unknown as ESLint.Plugin },
    rules: RULES,
  },
  { files: ["**/*.cjs", "**/*.cts"], languageOptions: { sourceType: "commonjs" } },
];

interface RuleInfo {
  category: Category;
  severity: Severity;
  title?: string;
  explanation: string;
  suggestion: string;
  references?: Reference[];
}

const js = (...lines: string[]) => ["```js", ...lines, "```"].join("\n");

const EVAL: RuleInfo = {
  category: "security",
  severity: "critical",
  title: "`eval`/`new Function` runs whatever code it is given",
  explanation:
    "`eval`, `new Function` and string arguments to `setTimeout` run arbitrary JavaScript. If the text can come from a user, they can run any code they like in your app. To read data use `JSON.parse`; to pick behaviour by name, use an object of functions.",
  suggestion: js(
    "const data = JSON.parse(text);",
    "// or",
    "const actions = { add, remove };",
    "actions[name]?.();",
  ),
};

const SPLIT =
  "Pull each distinct step into its own small, well-named function, then test those functions one at a time.";

const RULE_INFO: Record<string, RuleInfo> = {
  "no-eval": EVAL,
  "no-implied-eval": EVAL,
  "no-new-func": EVAL,
  "empty-catch": {
    category: "quality",
    severity: "medium",
    title: "Error swallowed by an empty `catch` block",
    explanation:
      "When a `catch` block is empty, the error is silently swallowed: the program carries on in a broken state and nobody finds out why. Log it, tell the user, or re-throw it if this code can't recover.",
    suggestion: js(
      "try {",
      "  return JSON.parse(text);",
      "} catch (error) {",
      '  console.error("Could not parse settings", error);',
      "  throw error;",
      "}",
    ),
    references: [
      {
        title: "MDN: try...catch",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch",
      },
    ],
  },
  "@typescript-eslint/no-unused-vars": {
    category: "quality",
    severity: "low",
    explanation:
      "This value is never used. It may be left over from earlier code, or you meant to use it and forgot.",
    suggestion: "Remove it, or use it where you meant to.",
  },
  "no-unreachable": {
    category: "quality",
    severity: "medium",
    explanation:
      "Code after `return`, `throw`, `break` or `continue` never runs. It's dead code that confuses readers.",
    suggestion: "Delete it, or move it above the statement that exits early.",
  },
  complexity: {
    category: "quality",
    severity: "medium",
    explanation:
      "This function has many paths through it, which makes it hard to read, test and change safely.",
    suggestion: SPLIT,
  },
  "max-lines-per-function": {
    category: "quality",
    severity: "medium",
    explanation:
      "Long functions are hard to understand and test. A function should usually do one job you can describe in a sentence.",
    suggestion: SPLIT,
  },
  "max-depth": {
    category: "quality",
    severity: "medium",
    explanation: "Deeply nested blocks are hard to follow.",
    suggestion: js(
      "// Return early instead of nesting:",
      "if (!user) return null;",
      "if (!user.isActive) return null;",
      "return render(user);",
    ),
  },
  "max-params": {
    category: "quality",
    severity: "low",
    explanation:
      "Functions with many parameters are easy to call with arguments in the wrong order.",
    suggestion: js(
      "function createUser({ name, email, role, team, avatar, locale }) {",
      "  // ...",
      "}",
    ),
  },
  "no-useless-catch": {
    category: "quality",
    severity: "low",
    explanation: "A `catch` that only re-throws the error does nothing.",
    suggestion: "Remove the `try`/`catch` and let the error propagate.",
  },
  eqeqeq: {
    category: "quality",
    severity: "low",
    explanation:
      '`==` converts types before comparing, so `0 == ""` is `true`. `===` compares without surprises.',
    suggestion: js("if (count === 0) {", "  // ...", "}"),
  },
  "no-debugger": {
    category: "quality",
    severity: "low",
    explanation:
      "A leftover `debugger` statement pauses the app whenever someone has dev tools open.",
    suggestion: "Remove the `debugger` statement before merging.",
  },
};

const FALLBACK: RuleInfo = {
  category: "quality",
  severity: "low",
  explanation: "ESLint flagged this line. The linked docs explain why it matters.",
  suggestion: "See the ESLint docs linked below for how to fix it.",
};

function docsFor(ruleId: string): Reference {
  if (ruleId === "empty-catch") {
    return {
      title: "ESLint rule no-empty",
      url: "https://eslint.org/docs/latest/rules/no-empty",
    };
  }
  if (ruleId.startsWith("@typescript-eslint/")) {
    const name = ruleId.slice("@typescript-eslint/".length);
    return {
      title: `typescript-eslint rule ${name}`,
      url: `https://typescript-eslint.io/rules/${name}`,
    };
  }
  return { title: `ESLint rule ${ruleId}`, url: `https://eslint.org/docs/latest/rules/${ruleId}` };
}

function toFinding(message: Linter.LintMessage, ruleId: string, file: string): Finding {
  const info = RULE_INFO[ruleId] ?? FALLBACK;
  const endLine = message.endLine;
  return {
    file,
    line: message.line,
    ...(endLine !== undefined && endLine > message.line ? { endLine } : {}),
    category: info.category,
    severity: info.severity,
    title: (info.title ?? message.message.replace(/\.$/, "")).slice(0, 120),
    explanation: info.explanation,
    suggestion: info.suggestion,
    references: [...(info.references ?? []), docsFor(ruleId)],
    confidence: info.category === "security" ? 0.8 : 0.9,
    source: "lint",
    ruleId: `eslint/${ruleId}`,
  };
}

/**
 * ESLint through its Node API with our own config. Running the student's ESLint setup
 * would execute their eslint.config.js and plugins, which is running student code.
 */
export const eslintTool: StaticTool = {
  name: "eslint",
  appliesTo: (file) => !file.partial && JS_FILES.test(file.path),
  async run(files, ctx) {
    const eslint = new ESLint({
      cwd: ctx.workspace.root,
      overrideConfigFile: true,
      overrideConfig: CONFIG,
      allowInlineConfig: false,
      errorOnUnmatchedPattern: false,
      warnIgnored: false,
      cache: false,
    });
    const results = await eslint.lintFiles(files.map((f) => f.absPath));

    const findings: Finding[] = [];
    const unparsable = new Set<string>();
    for (const result of results) {
      const file = ctx.workspace.toRepoPath(result.filePath);
      if (!file) continue;
      for (const message of result.messages) {
        if (message.fatal || message.ruleId === null) unparsable.add(file);
        else {
          const ruleId = message.ruleId === "no-restricted-syntax" ? "empty-catch" : message.ruleId;
          findings.push(toFinding(message, ruleId, file));
        }
      }
    }
    return {
      findings,
      ...(unparsable.size > 0
        ? {
            detail: `couldn't parse ${[...unparsable].join(", ")}, so they were only partly checked`,
          }
        : {}),
    };
  },
};

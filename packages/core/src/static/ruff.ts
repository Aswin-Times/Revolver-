import { z } from "zod";
import type { Category, Finding, Reference, Severity } from "../finding.js";
import { runTool, ToolError, type StaticTool } from "./tool.js";

/** Rules we ask Ruff for: bugs, security (bandit), swallowed errors, complexity, dead code. */
export const RUFF_SELECT = [
  "F",
  "E9",
  "E722",
  "B",
  "S",
  "BLE",
  "C90",
  "PLR0912",
  "PLR0913",
  "PLR0915",
  "ERA001",
];
/** Too noisy for student code: asserts, 0.0.0.0 binds, `random`, subprocess without a shell. */
export const RUFF_IGNORE = ["S101", "S104", "S311", "S603", "S607"];

/** Diagnostics about the tool's own ability to read a file, not about the student's code. */
const NOT_FINDINGS = new Set(["invalid-syntax", "E999", "E902"]);

const DiagnosticSchema = z.object({
  code: z.string().nullable(),
  name: z.string().optional(),
  message: z.string(),
  filename: z.string(),
  location: z.object({ row: z.number().int().positive() }),
  end_location: z.object({ row: z.number().int().positive() }).nullable().optional(),
  url: z.string().nullable().optional(),
});
type Diagnostic = z.infer<typeof DiagnosticSchema>;

interface RuleInfo {
  category: Category;
  severity: Severity;
  /** Overrides Ruff's message when that message isn't clear enough for students. */
  title?: string;
  explanation?: string;
  suggestion?: string;
  references?: Reference[];
}

const OWASP_SQL: Reference = {
  title: "OWASP SQL Injection Prevention Cheat Sheet",
  url: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
};
const OWASP_COMMAND: Reference = {
  title: "OWASP OS Command Injection Defense Cheat Sheet",
  url: "https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html",
};
const OWASP_DESERIALIZATION: Reference = {
  title: "OWASP Deserialization Cheat Sheet",
  url: "https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html",
};

const py = (...lines: string[]) => ["```python", ...lines, "```"].join("\n");

const SPECIFIC_EXCEPT = py(
  "try:",
  "    value = int(text)",
  "except ValueError:",
  "    value = None",
);
const SPLIT_FUNCTION =
  "Pull each distinct step into its own small, well-named function, then test those functions one at a time.";

const HARDCODED_PASSWORD: RuleInfo = {
  category: "security",
  severity: "high",
  explanation:
    "Passwords in source code end up in git history and in every copy of the repo. Read them from an environment variable instead.",
  suggestion: py("import os", "", 'password = os.environ["DB_PASSWORD"]'),
};

const RULES: Record<string, RuleInfo> = {
  S608: {
    category: "security",
    severity: "critical",
    title: "SQL query built by inserting values into the query text",
    explanation:
      "This query is built by putting a value straight into the SQL string. If that value comes from a user, they can change the query itself (SQL injection) and read or delete data they shouldn't. Let the database driver fill in values through placeholders instead.",
    suggestion: py('cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))'),
    references: [OWASP_SQL],
  },
  S602: {
    category: "security",
    severity: "critical",
    title: "Command run through the shell with `shell=True`",
    explanation:
      "With `shell=True` the whole string goes to the system shell, so input like `; rm -rf ~` runs as a second command. Pass the program and its arguments as a list so nothing is interpreted by a shell.",
    suggestion: py('subprocess.run(["ls", "-l", path], check=True)'),
    references: [OWASP_COMMAND],
  },
  S605: {
    category: "security",
    severity: "critical",
    title: "Command run through the shell with `os.system`",
    explanation:
      "`os.system` hands the whole string to the system shell, so input like `; rm -rf ~` runs as a second command. Use `subprocess.run` with a list of arguments instead.",
    suggestion: py("import subprocess", "", 'subprocess.run(["ls", "-l", path], check=True)'),
    references: [OWASP_COMMAND],
  },
  S307: {
    category: "security",
    severity: "critical",
    title: "`eval()` runs any code it is given",
    explanation:
      "`eval` executes arbitrary Python, so if its input can come from a user they can run whatever they like on your machine. To read a Python literal (number, list, dict) use `ast.literal_eval`; for JSON use `json.loads`.",
    suggestion: py("import ast", "", "value = ast.literal_eval(text)"),
  },
  S102: {
    category: "security",
    severity: "critical",
    title: "`exec()` runs any code it is given",
    explanation:
      "`exec` runs arbitrary Python. If any part of its input comes from a user, they control your program. There is almost always a safer way, such as a dictionary that maps names to functions.",
    suggestion: py('actions = {"add": add, "remove": remove}', "actions[name]()"),
  },
  S301: {
    category: "security",
    severity: "high",
    title: "`pickle` can run code hidden in the data it loads",
    explanation:
      "Unpickling can execute code embedded in the data. Only unpickle data your own program wrote and nobody else could have changed; for data from users or the network, use a safe format like JSON.",
    suggestion: py("import json", "", "data = json.loads(blob)"),
    references: [OWASP_DESERIALIZATION],
  },
  S506: {
    category: "security",
    severity: "high",
    title: "`yaml.load` can build arbitrary Python objects",
    explanation:
      "`yaml.load` with the default loader can create arbitrary Python objects from the file, which can lead to code execution. `yaml.safe_load` only builds plain data like dicts and lists.",
    suggestion: py("data = yaml.safe_load(text)"),
    references: [OWASP_DESERIALIZATION],
  },
  S105: HARDCODED_PASSWORD,
  S106: HARDCODED_PASSWORD,
  S107: HARDCODED_PASSWORD,
  S501: {
    category: "security",
    severity: "high",
    title: "HTTPS certificate checks are turned off",
    explanation:
      "`verify=False` makes the request accept any certificate, so anyone on the network can pretend to be the server and read or change the traffic. Leave verification on (it is the default).",
    suggestion: py("response = requests.get(url, timeout=10)"),
  },
  S201: {
    category: "security",
    severity: "high",
    title: "Flask debug mode is on",
    explanation:
      "Flask's debugger lets anyone who can reach the app run Python code on the server. Turn it on only on your own machine, for example from an environment variable.",
    suggestion: py("import os", "", 'app.run(debug=os.environ.get("FLASK_DEBUG") == "1")'),
  },
  S324: {
    category: "security",
    severity: "medium",
    explanation:
      "MD5 and SHA-1 are broken: attackers can create collisions cheaply. Use SHA-256 for checksums, and a slow password hash like bcrypt or argon2 for passwords.",
    suggestion: py("digest = hashlib.sha256(data).hexdigest()"),
  },
  S113: {
    category: "quality",
    severity: "low",
    title: "HTTP request without a timeout",
    explanation:
      "Without a timeout, a slow or unresponsive server can make your program hang forever.",
    suggestion: py("response = requests.get(url, timeout=10)"),
  },
  S110: {
    category: "quality",
    severity: "medium",
    title: "Exception caught and silently ignored",
    explanation:
      "When an error is caught and ignored, the program carries on in a broken state and nobody finds out why. At least log the error, and re-raise it if this code can't actually recover.",
    suggestion: py(
      "import logging",
      "",
      "logger = logging.getLogger(__name__)",
      "",
      "try:",
      "    data = load(blob)",
      "except ValueError:",
      '    logger.exception("Could not load data")',
      "    raise",
    ),
  },
  S112: {
    category: "quality",
    severity: "medium",
    title: "Exception caught and silently skipped",
    explanation:
      "Skipping items whenever anything goes wrong hides real bugs. Catch the specific error you expect and log what was skipped.",
    suggestion: SPECIFIC_EXCEPT,
  },
  E722: {
    category: "quality",
    severity: "medium",
    explanation:
      "A bare `except:` also catches things like Ctrl+C and typos that raise `NameError`, which hides real bugs. Catch only the errors you expect and can handle.",
    suggestion: SPECIFIC_EXCEPT,
  },
  BLE001: {
    category: "quality",
    severity: "medium",
    explanation:
      "Catching `Exception` hides bugs you didn't anticipate along with the error you meant to handle. Catch the specific exception types this code can recover from.",
    suggestion: SPECIFIC_EXCEPT,
  },
  B006: {
    category: "quality",
    severity: "medium",
    explanation:
      "Default values are created once, when the function is defined, so this list or dict is shared by every call and keeps changes from earlier calls. Default to `None` and create a fresh one inside the function.",
    suggestion: py("def load(blob, cache=None):", "    if cache is None:", "        cache = {}"),
  },
  F821: {
    category: "quality",
    severity: "high",
    explanation:
      "Python doesn't know this name, so this line will crash with a `NameError` when it runs. Check for a typo or a missing import.",
    suggestion: "Fix the spelling, or import or define the name before this line.",
  },
  F401: {
    category: "quality",
    severity: "low",
    explanation: "This import isn't used. Removing it keeps the file easier to read.",
    suggestion: "Delete the unused import.",
  },
  F841: {
    category: "quality",
    severity: "low",
    explanation:
      "This value is never used. It may be left over from earlier code, or you meant to use it and forgot.",
    suggestion: "Remove the assignment, or use the variable where you meant to.",
  },
  C901: {
    category: "quality",
    severity: "medium",
    explanation:
      "This function has many paths through it, which makes it hard to read, test and change safely.",
    suggestion: SPLIT_FUNCTION,
  },
  PLR0915: {
    category: "quality",
    severity: "medium",
    explanation:
      "Long functions are hard to understand and test. A function should usually do one job you can describe in a sentence.",
    suggestion: SPLIT_FUNCTION,
  },
  PLR0912: {
    category: "quality",
    severity: "medium",
    explanation: "Many `if`/`elif` branches make a function hard to follow and to test fully.",
    suggestion:
      "Replace long `if`/`elif` chains with a dictionary lookup, or move each branch into its own function.",
  },
  PLR0913: {
    category: "quality",
    severity: "low",
    explanation:
      "Functions with many parameters are easy to call with arguments in the wrong order.",
    suggestion:
      "Group related parameters into a dataclass, or split the function into smaller ones.",
  },
  ERA001: {
    category: "quality",
    severity: "low",
    explanation:
      "Old code left in comments makes files harder to read, and git already remembers previous versions for you.",
    suggestion: "Delete the commented-out lines; you can get them back from git history.",
  },
};

function ruleInfo(code: string): RuleInfo {
  return (
    RULES[code] ??
    (code.startsWith("S")
      ? { category: "security", severity: "medium" }
      : { category: "quality", severity: "low" })
  );
}

function toFinding(diagnostic: Diagnostic, code: string, file: string): Finding {
  const info = ruleInfo(code);
  const url = diagnostic.url?.startsWith("https://") ? diagnostic.url : undefined;
  const docs: Reference[] = url
    ? [{ title: `Ruff rule ${code}${diagnostic.name ? `: ${diagnostic.name}` : ""}`, url }]
    : [];
  const endRow = diagnostic.end_location?.row;

  return {
    file,
    line: diagnostic.location.row,
    ...(endRow !== undefined && endRow > diagnostic.location.row ? { endLine: endRow } : {}),
    category: info.category,
    severity: info.severity,
    title: (info.title ?? diagnostic.message).slice(0, 120),
    explanation:
      info.explanation ??
      `Ruff flagged this (${code}): ${diagnostic.message}. The linked docs explain why it matters.`,
    suggestion: info.suggestion ?? `See how to fix it in the Ruff docs${url ? `: ${url}` : "."}`,
    references: [...(info.references ?? []), ...docs],
    confidence: info.category === "security" ? 0.8 : 0.9,
    source: "lint",
    ruleId: `ruff/${code}`,
  };
}

export function parseRuffOutput(
  json: string,
  toRepoPath: (toolPath: string) => string | undefined,
): { findings: Finding[]; unparsable: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ToolError("ruff printed something that isn't JSON");
  }
  const parsed = z.array(DiagnosticSchema).safeParse(data);
  if (!parsed.success) throw new ToolError("ruff printed JSON in an unexpected shape");

  const findings: Finding[] = [];
  const unparsable = new Set<string>();
  for (const diagnostic of parsed.data) {
    const file = toRepoPath(diagnostic.filename);
    if (!file) continue;
    const code = diagnostic.code ?? "invalid-syntax";
    if (NOT_FINDINGS.has(code)) unparsable.add(file);
    else findings.push(toFinding(diagnostic, code, file));
  }
  return { findings, unparsable: [...unparsable] };
}

export const ruffTool: StaticTool = {
  name: "ruff",
  appliesTo: (file) => !file.partial && /\.pyi?$/.test(file.path),
  async run(files, ctx) {
    const result = await runTool(ctx, "ruff", [
      "check",
      "--isolated",
      "--no-cache",
      "--exit-zero",
      "--output-format",
      "json",
      "--select",
      RUFF_SELECT.join(","),
      "--ignore",
      RUFF_IGNORE.join(","),
      "--",
      ...files.map((f) => f.absPath),
    ]);
    const { findings, unparsable } = parseRuffOutput(result.stdout, ctx.workspace.toRepoPath);
    return {
      findings,
      ...(unparsable.length > 0
        ? {
            detail: `couldn't parse ${unparsable.join(", ")} (syntax error), so they were only partly checked`,
          }
        : {}),
    };
  },
};

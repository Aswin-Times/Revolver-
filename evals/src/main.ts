import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "@pr-mentor/core";
import { loadCases } from "./case.js";
import { CASES_DIR } from "./fixtures.js";
import {
  buildReport,
  checkThresholds,
  renderReport,
  type EvalReport,
  type Thresholds,
} from "./report.js";
import { runEval, type Mode } from "./run.js";

const EVALS_DIR = fileURLToPath(new URL("..", import.meta.url));

const USAGE = `Usage: pnpm eval [options]

  --mode static|full|oracle|null   static: tools only (free). full: with Claude (costs money).
                                   oracle/null: harness self-checks. Default: static
  --reps <n>                       repeat each case n times (full mode only). Default: 3
  --case <id,id>                   only these cases
  --max-cost <usd>                 stop starting cases once Claude spend reaches this. Default: 5
  --compare <report.json>          show the change against an earlier run
  --check-thresholds               exit 1 if a metric falls below evals/thresholds.json
  --baseline                       also write evals/reports/baseline-<mode>.md`;

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "static" },
    reps: { type: "string", default: "3" },
    case: { type: "string" },
    "max-cost": { type: "string", default: "5" },
    compare: { type: "string" },
    "check-thresholds": { type: "boolean" },
    baseline: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const mode = values.mode as Mode;
if (!["static", "full", "oracle", "null"].includes(mode)) {
  console.error(`Unknown --mode "${values.mode}".\n\n${USAGE}`);
  process.exit(2);
}

const cases = await loadCases(CASES_DIR, values.case?.split(","));
const config = loadConfig(process.env);
const reps = Number(values.reps);
const maxCostUsd = Number(values["max-cost"]);
if (mode === "full") {
  console.error(
    `Running ${cases.length} cases × ${reps} reps with ${config.model} (effort ${config.effort}); cost cap $${maxCostUsd}.`,
  );
}

const out = await runEval(cases, { mode, config, reps, maxCostUsd });
const report = buildReport(out, cases.length);
const previous = values.compare
  ? (JSON.parse(await readFile(values.compare, "utf8")) as EvalReport)
  : undefined;
const markdown = renderReport(report, previous);

const runDir = join(EVALS_DIR, "runs", `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(runDir, { recursive: true });
await writeFile(
  join(runDir, "results.jsonl"),
  out.results.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
await writeFile(
  join(runDir, "errors.jsonl"),
  out.errors.map((e) => JSON.stringify(e)).join("\n") + (out.errors.length ? "\n" : ""),
);
await writeFile(
  join(runDir, "report.json"),
  JSON.stringify({ ...report, model: config.model, effort: config.effort }, null, 2) + "\n",
);
await writeFile(join(runDir, "report.md"), markdown);
if (values.baseline) await writeFile(join(EVALS_DIR, "reports", `baseline-${mode}.md`), markdown);

console.log(markdown);
console.error(`Run saved to ${runDir}`);

if (values["check-thresholds"]) {
  const all = JSON.parse(await readFile(join(EVALS_DIR, "thresholds.json"), "utf8")) as Record<
    string,
    Thresholds
  >;
  const failures = checkThresholds(report, all[mode] ?? {});
  if (failures.length > 0) {
    console.error(`Thresholds not met:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.error("All thresholds met.");
}

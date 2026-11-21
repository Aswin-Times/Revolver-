import { posix } from "node:path";
import type { FileDiff } from "../diff/types.js";

export interface NewFunction {
  name: string;
  /** New-side line of the definition. */
  line: number;
}

const PYTHON = [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/];
const JAVASCRIPT = [
  // function name(  /  export default async function name(
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
  // const name = (...) =>  /  const name = async x =>  /  let name = function
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  // class or object methods: `async load(id: string): Promise<Cart> {`
  /^\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/,
];
const GO = [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[([]/];
const JAVA_LIKE = [
  /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|override|async|virtual)\s+)+(?:<[^>]+>\s+)?[\w<>[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*(?:\w+\s+)*fun\s+([A-Za-z_]\w*)\s*\(/,
];
const RUBY = [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/];

const PATTERNS: Record<string, RegExp[]> = {
  ".py": PYTHON,
  ".go": GO,
  ".rb": RUBY,
  ".java": JAVA_LIKE,
  ".kt": JAVA_LIKE,
  ".cs": JAVA_LIKE,
};
for (const ext of [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]) {
  PATTERNS[ext] = JAVASCRIPT;
}

/** Things that look like `name(...) {` but aren't definitions worth testing on their own. */
const NOT_FUNCTIONS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "with",
  "constructor",
]);
const DUNDER = /^__\w+__$/;

/** Functions and methods defined on lines this diff added. */
export function newFunctions(file: FileDiff): NewFunction[] {
  const patterns = PATTERNS[posix.extname(file.path).toLowerCase()];
  if (!patterns) return [];

  const found: NewFunction[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "add") continue;
      for (const pattern of patterns) {
        const name = pattern.exec(line.content)?.[1];
        if (name && !NOT_FUNCTIONS.has(name) && !DUNDER.test(name)) {
          found.push({ name, line: line.newLine });
          break;
        }
      }
    }
  }
  return found;
}

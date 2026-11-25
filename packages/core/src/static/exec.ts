import { spawn } from "node:child_process";

export interface CommandOptions {
  cwd: string;
  timeoutMs: number;
  /** Per-stream cap on captured output. Anything beyond it is discarded. Default 10 MB. */
  maxOutputBytes?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  /** Null when the process was killed (for example on timeout). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/** Runs a program. Injectable so tool wrappers can be tested without the real tools. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandResult>;

export class ToolNotFoundError extends Error {
  override name = "ToolNotFoundError";
  constructor(readonly command: string) {
    super(`'${command}' is not installed or not on PATH`);
  }
}

const DEFAULT_MAX_OUTPUT = 10_000_000;
const KILL_GRACE_MS = 2_000;

/**
 * Run a program directly, never through a shell, so file names from a student's diff
 * can't be interpreted as shell syntax. Enforces a timeout and caps captured output.
 */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: options.env,
    });

    let timedOut = false;
    let truncated = false;
    const capture = () => {
      const chunks: Buffer[] = [];
      let size = 0;
      return {
        push(chunk: Buffer) {
          const room = maxBytes - size;
          if (room <= 0) {
            truncated = true;
            return;
          }
          if (chunk.length > room) truncated = true;
          const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
          chunks.push(kept);
          size += kept.length;
        },
        text: () => Buffer.concat(chunks).toString("utf8"),
      };
    };
    const stdout = capture();
    const stderr = capture();
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    let forceKill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      forceKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    }, options.timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error.code === "ENOENT" ? new ToolNotFoundError(command) : error);
    });

    child.on("close", (code) => {
      cleanup();
      resolve({
        exitCode: code,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut,
        truncated,
      });
    });
    if (child.stdin && options.input !== undefined) {
      child.stdin.on("error", reject);
      child.stdin.end(options.input);
    }
  });

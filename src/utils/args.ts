/**
 * Parse command-line arguments for common options like --account
 */

export interface ParsedArgs {
  account: string;
  args: string[];
}

// Splits `--flag=value` / `-x=value` into `["--flag", "value"]` so every
// downstream parser that only matches the literal `--flag` token still finds
// its value. Tokens not starting with `-` and tokens without `=` are left
// untouched. Used at the CLI entry point as a single normalization pass.
// Looks up `--flag` in args and returns the following token, or undefined if
// the flag is missing or has no value. Assumes args have been normalized by
// `normalizeArgs` so `--flag=value` callers don't need a separate code path.
export function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

export function normalizeArgs(args: string[]): string[] {
  const out: string[] = [];
  let sawDoubleDash = false;
  for (const arg of args) {
    if (sawDoubleDash) {
      out.push(arg);
      continue;
    }
    if (arg === "--") {
      sawDoubleDash = true;
      out.push(arg);
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        out.push(arg.slice(0, eq), arg.slice(eq + 1));
        continue;
      }
    }
    out.push(arg);
  }
  return out;
}

export function parseAccount(args: string[]): ParsedArgs {
  let account = "default";
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--account" && i + 1 < args.length) {
      account = args[i + 1]!;
      i++; // Skip next arg since we consumed it
    } else if (arg.startsWith("--account=")) {
      account = arg.slice("--account=".length);
    } else {
      filteredArgs.push(arg);
    }
  }

  return { account, args: filteredArgs };
}

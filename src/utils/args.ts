/**
 * Parse command-line arguments for common options like --account
 */

export interface ParsedArgs {
  account: string;
  args: string[];
}

export function parseAccount(args: string[]): ParsedArgs {
  let account = "default";
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--account" && i + 1 < args.length) {
      account = args[i + 1];
      i++; // Skip next arg since we consumed it
    } else {
      filteredArgs.push(args[i]);
    }
  }

  return { account, args: filteredArgs };
}

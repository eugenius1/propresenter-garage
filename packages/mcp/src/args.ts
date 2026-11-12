/**
 * The command line: library folders, and two options.
 *
 * `--read-only` also takes `=true` or `=false`, because the Claude Desktop
 * extension can only pass a setting's value inside a fixed argument, and an
 * unticked box arrives as `--read-only=false`.
 */
export interface Args {
  folders: string[];
  readOnly: boolean;
  backupDir?: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { folders: [], readOnly: false };
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      args.folders.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? undefined : arg.slice(eq + 1);
    if (flag === "--read-only") {
      if (value !== undefined && value !== "true" && value !== "false") {
        throw new Error(`--read-only takes true or false, not ${value}`);
      }
      args.readOnly = value !== "false";
    } else if (flag === "--backup-dir") {
      if (!value) throw new Error("--backup-dir needs a folder: --backup-dir=<folder>");
      args.backupDir = value;
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return args;
}

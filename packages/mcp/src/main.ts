import os from "node:os";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openRoots } from "@propresenter-garage/node/library";
import { defaultBackupDir, openBackupDir } from "@propresenter-garage/node/write";
import { parseArgs } from "./args";
import { createServer } from "./server";

/**
 * Start the server on stdio.
 *
 *   node packages/mcp/dist/propresenter-mcp.mjs [--read-only] [--backup-dir=<folder>] [library folder...]
 *
 * With no folder named it reads `~/Documents/ProPresenter`, where ProPresenter
 * keeps its libraries and playlists on both macOS and Windows.
 */
async function main() {
  const { folders, readOnly, backupDir } = parseArgs(process.argv.slice(2));
  const dirs = folders.length > 0 ? folders : [path.join(os.homedir(), "Documents", "ProPresenter")];
  const roots = await openRoots(dirs);
  // Checked now, so a backup folder inside a library is refused at start-up
  // rather than after a person has read and approved every line. A backup
  // folder that cannot be used turns editing off rather than reading: no
  // backup, no write, but nothing stops a model reading the library.
  // stdout is the protocol channel; anything for a person goes to stderr.
  let backups: string | undefined;
  if (!readOnly) {
    try {
      backups = await openBackupDir(backupDir ?? defaultBackupDir(), roots);
    } catch (e) {
      console.error(`Editing is off: ${e instanceof Error ? e.message : e}`);
    }
  }
  const editing = backups !== undefined;
  await createServer(roots, { readOnly: !editing, backupDir: backups }).connect(new StdioServerTransport());
  console.error(
    `propresenter-garage MCP ${editing ? `reading and editing ${roots.join(", ")}, backing up to ${backups}` : `reading ${roots.join(", ")}`}`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

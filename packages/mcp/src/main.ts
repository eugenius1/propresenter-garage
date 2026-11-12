import os from "node:os";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openRoots } from "@propresenter-garage/node/library";
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
  await createServer(roots, { readOnly, backupDir }).connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for a person goes to stderr.
  console.error(`propresenter-garage MCP ${readOnly ? "reading" : "reading and editing"} ${roots.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

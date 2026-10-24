import os from "node:os";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openRoots } from "./library";
import { createServer } from "./server";

/**
 * Start the server on stdio.
 *
 *   node packages/mcp/dist/propresenter-mcp.mjs [library folder...]
 *
 * With no folder named it reads `~/Documents/ProPresenter`, where ProPresenter
 * keeps its libraries and playlists on both macOS and Windows.
 */
async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length > 0 ? args : [path.join(os.homedir(), "Documents", "ProPresenter")];
  const roots = await openRoots(dirs);
  await createServer(roots).connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for a person goes to stderr.
  console.error(`propresenter-garage MCP reading ${roots.join(", ")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

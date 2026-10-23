// Package the bundled MCP server as a Claude Desktop extension (.mcpb).
//
// A .mcpb is a zip of a manifest and the server. Claude Desktop ships its own
// Node, so the one self-contained file from `npm run mcp:bundle` is the whole
// server: nothing to install beside it, and no node_modules in the zip.
//
// The manifest lives in mcpb/ without a version; the version comes from
// package.json here so there is only one to bump. `mcpb pack` validates the
// result against the official schema, so a manifest mistake fails the build.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const server = "dist-mcp/propresenter-mcp.mjs";
const stage = "dist-mcp/bundle";
const output = "dist-mcp/propresenter-garage.mcpb";

if (!fs.existsSync(server)) {
  console.error(`pack-mcpb: no ${server} -- run npm run mcp:bundle first`);
  process.exit(1);
}

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const { $schema: _editorOnly, ...manifest } = JSON.parse(fs.readFileSync("mcpb/manifest.json", "utf8"));

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify({ ...manifest, version }, null, 2) + "\n");
fs.copyFileSync(server, path.join(stage, manifest.server.entry_point));
fs.copyFileSync("public/icon-512.png", path.join(stage, manifest.icon));

try {
  execFileSync(path.join("node_modules", ".bin", "mcpb"), ["pack", stage, output], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
} catch (e) {
  // mcpb prints the schema errors on stdout, which is otherwise just noise.
  console.error(e.stdout || e.message);
  process.exit(1);
}
console.log(`pack-mcpb -> ${output}`);

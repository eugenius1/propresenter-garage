// Package the bundled MCP server as a Claude Desktop extension (.mcpb).
//
// A .mcpb is a zip of a manifest and the server. Claude Desktop ships its own
// Node, so the one self-contained file from `npm run mcp:build` is the whole
// server: nothing to install beside it, and no node_modules in the zip.
//
// manifest.json is kept without a version; the version comes from this
// package's package.json, so there is only one to bump. `packExtension`
// validates the result against the official schema and prints what is wrong,
// so a manifest mistake fails the build.
import { packExtension } from "@anthropic-ai/mcpb";
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
// The file npm installs is the file the extension runs.
const server = pkg.bin[pkg.name];
const stage = "dist/bundle";
const output = "dist/propresenter-garage.mcpb";

if (!fs.existsSync(server)) {
  console.error(`pack-mcpb: no ${server} -- run npm run mcp:build first`);
  process.exit(1);
}

const { $schema: _editorOnly, ...manifest } = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify({ ...manifest, version: pkg.version }, null, 2) + "\n");
fs.copyFileSync(server, path.join(stage, manifest.server.entry_point));
fs.copyFileSync("LICENSE", path.join(stage, "LICENSE"));
// The app's icon, so the extension looks like the same product.
fs.copyFileSync("../../apps/web/public/icon-512.png", path.join(stage, manifest.icon));

if (!(await packExtension({ extensionPath: stage, outputPath: output, silent: false }))) process.exit(1);
console.log(`pack-mcpb -> ${output}`);

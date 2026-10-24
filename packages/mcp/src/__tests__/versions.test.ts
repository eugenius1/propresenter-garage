import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every package carries the repository's one version.
 *
 * The MCP server is published to npm and stamps its version into the Claude
 * Desktop extension, so a version that drifted from the others would ship a
 * release nobody can match to a commit. Bump them together with
 * `npm version <v> --workspaces --include-workspace-root`.
 */
const read = (relative: string) =>
  JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8")) as {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

const root = read("../../../../package.json");
const packages = ["core", "web", "mcp"].map((name) => read(`../../../${name}/package.json`));

describe("versions", () => {
  it("are the same in every package", () => {
    for (const pkg of packages) expect(pkg.version, pkg.name).toBe(root.version);
  });

  it("pin each package's dependency on core to that version", () => {
    for (const pkg of packages) {
      const wanted = { ...pkg.dependencies, ...pkg.devDependencies }["@propresenter-garage/core"];
      if (wanted !== undefined) expect(wanted, pkg.name).toBe(root.version);
    }
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

// Re-vendor proto/ from upstream and record exactly which commit it came from.
//
//   node scripts/update-protos.mjs [ref]
//
// Why vendor rather than use a git submodule: a submodule pins a commit, which
// is the good part, but it also means every clone and every CI job needs
// --recurse-submodules or it silently ends up with an empty proto/ and a
// baffling build error. More importantly the upstream is an unofficial,
// reverse-engineered schema; if it is ever rewritten or taken down, a submodule
// breaks and a vendored copy does not. This script gives us the submodule's
// precision -- a recorded commit hash, a deliberate bump, a reviewable diff --
// without either downside.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UPSTREAM = "https://github.com/greyshirtguy/ProPresenter7-Proto.git";
const SOURCE_DIR = "autogen-proto";
const DEST = "proto";
const PROVENANCE = path.join(DEST, "PROVENANCE.json");
const LICENSE_NAME = "LICENSE-ProPresenter7-Proto";

const ref = process.argv[2] ?? "master";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "pp-proto-"));

try {
  console.log(`fetching ${UPSTREAM} at ${ref}`);
  git(["init", "-q", checkout]);
  git(["remote", "add", "origin", UPSTREAM], checkout);
  git(["fetch", "-q", "--depth", "1", "origin", ref], checkout);
  git(["checkout", "-q", "FETCH_HEAD"], checkout);

  const commit = git(["rev-parse", "HEAD"], checkout);
  const committedAt = git(["show", "-s", "--format=%cI", "HEAD"], checkout);

  const source = path.join(checkout, SOURCE_DIR);
  if (!fs.existsSync(source)) {
    throw new Error(`upstream has no ${SOURCE_DIR}/ directory at ${ref} -- has the layout changed?`);
  }

  // Keep our own licence copy and provenance; everything else is replaced, so
  // files deleted upstream disappear here too.
  const keep = new Set([LICENSE_NAME, path.basename(PROVENANCE)]);
  const before = new Set(listFiles(DEST));
  for (const entry of fs.readdirSync(DEST)) {
    if (keep.has(entry)) continue;
    fs.rmSync(path.join(DEST, entry), { recursive: true, force: true });
  }

  fs.cpSync(source, DEST, { recursive: true });

  const upstreamLicense = path.join(checkout, "LICENSE");
  if (fs.existsSync(upstreamLicense)) {
    fs.copyFileSync(upstreamLicense, path.join(DEST, LICENSE_NAME));
  }

  const versionFile = path.join(DEST, "version.txt");
  const proPresenterVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, "utf8").trim()
    : null;

  fs.writeFileSync(
    PROVENANCE,
    JSON.stringify(
      {
        upstream: UPSTREAM,
        ref,
        commit,
        committedAt,
        proPresenterVersion,
        vendoredAt: new Date().toISOString(),
        sourceDirectory: SOURCE_DIR,
        note:
          "Vendored, not a submodule -- see the comment at the top of " +
          "scripts/update-protos.mjs. Licence: MIT, see " + LICENSE_NAME + ".",
      },
      null,
      2
    ) + "\n"
  );

  const after = new Set(listFiles(DEST));
  const added = [...after].filter((f) => !before.has(f));
  const removed = [...before].filter((f) => !after.has(f));

  console.log(`commit   ${commit}`);
  console.log(`date     ${committedAt}`);
  console.log(`version  ProPresenter ${proPresenterVersion ?? "unknown"}`);
  console.log(`files    ${after.size} (${added.length} added, ${removed.length} removed)`);
  for (const f of added.slice(0, 10)) console.log(`  + ${f}`);
  for (const f of removed.slice(0, 10)) console.log(`  - ${f}`);
  console.log("\nnow run: npm run protos && npm run check");
} finally {
  fs.rmSync(checkout, { recursive: true, force: true });
}

function listFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), rel)
      : [rel];
  });
}

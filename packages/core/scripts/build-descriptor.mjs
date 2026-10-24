// Build-time step: collapse the vendored .proto tree into one JSON descriptor.
// Shipping the descriptor instead of the .proto files means the app never parses
// schema text at runtime -- protobuf.js loads it via Root.fromJSON() instantly.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { loadProtoRoot, PROTO_DIR } from "./proto-root.mjs";

const ROOT_TYPE = "rv.data.PlaylistDocument";
const OUT = "src/generated/pp.descriptor.json";

const root = await loadProtoRoot();

// Fail the build rather than ship a descriptor the app can't use.
root.lookupType(ROOT_TYPE);

const json = JSON.stringify(root.toJSON());
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, json);

const version = fs.readFileSync(path.join(PROTO_DIR, "version.txt"), "utf8").trim();

// Provenance is written by scripts/update-protos.mjs. Carry the upstream commit
// through to the interface so a reported problem can be tied to an exact schema.
const provenancePath = path.join(PROTO_DIR, "PROVENANCE.json");
const provenance = fs.existsSync(provenancePath)
  ? JSON.parse(fs.readFileSync(provenancePath, "utf8"))
  : {};

fs.writeFileSync(
  "src/generated/proto-version.json",
  JSON.stringify(
    {
      version,
      files: root.files.length,
      builtAt: new Date().toISOString(),
      upstreamCommit: provenance.commit ?? null,
      upstreamCommittedAt: provenance.committedAt ?? null,
    },
    null,
    2
  )
);

console.log(
  `descriptor -> ${OUT}  (${(json.length / 1024).toFixed(0)} KB raw, ` +
  `${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped, ${root.files.length} proto files, ProPresenter ${version})`
);

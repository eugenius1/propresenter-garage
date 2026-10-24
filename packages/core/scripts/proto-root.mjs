// The vendored ProPresenter schema, loaded as protobuf.js sees it, for the
// build and dev scripts. Resolved from this file rather than the working
// directory, so a script works wherever it is started from.
import protobuf from "protobufjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTO_DIR = fileURLToPath(new URL("../proto", import.meta.url));

// Where npm put protobuf.js, for its bundled google/protobuf/*.proto: hoisted to
// the workspace root, not beside this package.
const PROTOBUFJS_DIR = path.dirname(fileURLToPath(import.meta.resolve("protobufjs")));

export async function loadProtoRoot() {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) =>
    target.startsWith("google/protobuf/") ? path.join(PROTOBUFJS_DIR, target) : path.join(PROTO_DIR, target);
  await root.load("propresenter.proto", { keepCase: true });
  return root;
}

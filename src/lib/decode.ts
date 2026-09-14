// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import protobuf from "protobufjs";
import descriptor from "../generated/pp.descriptor.json";
import protoVersion from "../generated/proto-version.json";

export const PROTO_VERSION = protoVersion;

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
const PlaylistDocument = root.lookupType("rv.data.PlaylistDocument");

/**
 * The playlist kinds a tool can ask for.
 *
 * `PlaylistDocument` is one message serving all of them, distinguished only by
 * its `type` field -- so every tool decodes through the same path and states
 * which kind it expects.
 */
export type PlaylistKind = "presentation" | "media" | "audio";

const KIND_TYPE: Record<PlaylistKind, number> = {
  presentation: 1,
  media: 2,
  audio: 3,
};

export type RawDoc = protobuf.Message<{}> & Record<string, any>;

export type DecodeErrorCode = "empty" | "notProtobuf" | "wrongPlaylistType";

/**
 * A decode failure, carrying a code rather than a sentence.
 *
 * The library must not decide what language the reader sees, so the message is
 * assembled in the interface layer from `code` and `params`. The `message`
 * field holds the code purely so stack traces stay readable.
 */
export class DecodeError extends Error {
  readonly code: DecodeErrorCode;
  readonly params: Record<string, string>;

  constructor(code: DecodeErrorCode, params: Record<string, string> = {}) {
    super(code);
    this.name = "DecodeError";
    this.code = code;
    this.params = params;
  }
}

/**
 * Decode a playlist document, rejecting it unless it is the expected kind.
 *
 * The error names both the expected and the actual kind, so the interface can
 * say what was wanted rather than hardcoding one tool's advice.
 */
export function decodeDocument(bytes: Uint8Array, expected: PlaylistKind): RawDoc {
  let doc: RawDoc;
  try {
    doc = PlaylistDocument.decode(bytes) as RawDoc;
  } catch (e) {
    throw new DecodeError("notProtobuf", { reason: (e as Error).message });
  }
  if (doc.type !== KIND_TYPE[expected]) {
    throw new DecodeError("wrongPlaylistType", {
      expected,
      actual: playlistTypeKey(doc.type),
    });
  }
  return doc;
}

/** Which `PlaylistDocument.Type` this is, as a key the interface can translate. */
export type PlaylistTypeKey = "unknown" | "presentation" | "media" | "audio";

function playlistTypeKey(t: unknown): PlaylistTypeKey {
  const byValue: Record<number, PlaylistTypeKey> = {
    0: "unknown",
    1: "presentation",
    2: "media",
    3: "audio",
  };
  return byValue[t as number] ?? "unknown";
}

/** Resolve a numeric enum value to its schema name, e.g. 2 -> "WIN32". */
export function enumLabel(fullyQualifiedEnum: string, value: unknown): string {
  if (typeof value === "string") return value.replace(/^[A-Z]+_/, "");
  try {
    const e = root.lookupEnum(fullyQualifiedEnum);
    const name = Object.keys(e.values).find((k) => e.values[k] === value);
    if (name) return name.replace(/^[A-Z]+_/, "");
  } catch {
    /* fall through to the raw value */
  }
  return String(value ?? "unknown");
}

/** Look up a message type from the vendored schema, for code that builds messages. */
export function messageType(fullyQualifiedName: string): protobuf.Type {
  return root.lookupType(fullyQualifiedName);
}

export function encodeDocument(doc: RawDoc): Uint8Array {
  return PlaylistDocument.encode(doc).finish();
}

/**
 * How faithfully a file survives being written back out.
 *
 * - `identical`  bytes match exactly. Safest possible result.
 * - `equivalent` bytes differ but the decoded content is the same, i.e. the
 *                original was encoded non-canonically (redundant default
 *                values, unusual field ordering). Nothing is lost, so export
 *                is still safe.
 * - `lossy`      decoded content differs. Some field is not covered by the
 *                schema and would be dropped. Export must be refused.
 */
export type Fidelity = "identical" | "equivalent" | "lossy";

export interface FidelityReport {
  fidelity: Fidelity;
  originalSize: number;
  reEncodedSize: number;
  /** Whether writing this file back out preserves everything it contains. */
  exportSafe: boolean;
}

const TO_OBJECT: protobuf.IConversionOptions = {
  defaults: false,
  arrays: true,
  objects: true,
  enums: Number,
  longs: String,
  bytes: String,
};

function canonical(type: protobuf.Type, bytes: Uint8Array): string {
  return JSON.stringify(type.toObject(type.decode(bytes), TO_OBJECT));
}

/**
 * The safety gate on every path that writes a file.
 *
 * protobuf.js discards fields the schema does not declare. Since the schema is
 * reverse-engineered from the application, a field ProPresenter writes but the
 * protos omit would silently vanish on re-encode and corrupt the library. This
 * decodes, re-encodes, and then checks both the bytes and the decoded content
 * so a merely non-canonical original is not mistaken for data loss.
 *
 * Takes the message type rather than assuming one: a presentation is a
 * different root message from a playlist, and needs exactly the same gate
 * before anything is written back.
 */
export function checkTypeFidelity(type: protobuf.Type, bytes: Uint8Array): FidelityReport {
  const reEncoded = type.encode(type.decode(bytes)).finish();

  const sameBytes =
    reEncoded.length === bytes.length && reEncoded.every((b, i) => b === bytes[i]);

  const fidelity: Fidelity = sameBytes
    ? "identical"
    : canonical(type, bytes) === canonical(type, reEncoded)
      ? "equivalent"
      : "lossy";

  return {
    fidelity,
    originalSize: bytes.length,
    reEncodedSize: reEncoded.length,
    exportSafe: fidelity !== "lossy",
  };
}

/** The gate for a playlist document, which is what the export feature writes. */
export function checkFidelity(bytes: Uint8Array): FidelityReport {
  return checkTypeFidelity(PlaylistDocument, bytes);
}

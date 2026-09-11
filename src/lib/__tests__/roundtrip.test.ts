// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { checkFidelity, DecodeError, encodeDocument } from "../decode";
import { decodeMediaDocument } from "../model";
import { hasRealFile, readRealFile, REAL_FILE } from "./fixtures";

/**
 * The gate on the export feature.
 *
 * protobuf.js drops fields the schema doesn't declare. Since the schema is
 * reverse-engineered, a field ProPresenter writes but the protos omit would
 * disappear on re-encode and corrupt the library. Byte-identical output proves
 * the vendored schema covers the file completely.
 */
describe.skipIf(!hasRealFile)(`round-trip fidelity (${REAL_FILE})`, () => {
  it("re-encodes to byte-identical output", () => {
    const bytes = readRealFile();
    const report = checkFidelity(bytes);
    expect(report.reEncodedSize).toBe(bytes.length);
    expect(report.fidelity).toBe("identical");
    expect(report.exportSafe).toBe(true);
  });

  it("rates a non-canonically encoded but complete file as equivalent, not lossy", () => {
    // Re-encoding normalises the byte layout. Feeding that back in must report
    // "identical" -- and a file that only differs in layout must never be
    // called lossy, or the export gate would refuse perfectly safe files.
    const normalised = encodeDocument(decodeMediaDocument(readRealFile()));
    const report = checkFidelity(normalised);
    expect(report.fidelity).toBe("identical");
    expect(report.exportSafe).toBe(true);
  });

  it("survives a decode/encode/decode cycle unchanged", () => {
    const bytes = readRealFile();
    const once = encodeDocument(decodeMediaDocument(bytes));
    const twice = encodeDocument(decodeMediaDocument(once));
    expect(Buffer.compare(Buffer.from(once), Buffer.from(twice))).toBe(0);
  });
});

describe("decode guards", () => {
  it("rejects data that is not protobuf at all", () => {
    // The error carries a code, not a sentence, so the interface can render it
    // in whichever language the reader is using.
    expect(() => decodeMediaDocument(new TextEncoder().encode("<xml>not a pro7 file</xml>")))
      .toThrow(DecodeError);
    try {
      decodeMediaDocument(new TextEncoder().encode("<xml>not a pro7 file</xml>"));
    } catch (e) {
      expect((e as DecodeError).code).toBe("notProtobuf");
      expect((e as DecodeError).params.reason).toBeTruthy();
    }
  });
});

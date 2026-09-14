// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, zip, ZipError } from "../zip";

const text = (s: string) => new TextEncoder().encode(s);

/**
 * Read an archive back with node's own inflate.
 *
 * Deliberately a second implementation rather than a mirror of the writer:
 * a reader that shared the writer's idea of the format would agree with it
 * even when both were wrong.
 */
function unzip(archive: Uint8Array): { path: string; bytes: Uint8Array }[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();

  // Find the end-of-directory record, then walk the directory it points at.
  let end = archive.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  expect(end, "end of central directory").toBeGreaterThanOrEqual(0);

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: { path: string; bytes: Uint8Array }[] = [];

  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength));

    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    const dataAt = offset + 30 + localName + localExtra;
    const raw = archive.subarray(dataAt, dataAt + compressed);

    const bytes =
      method === 0 ? Uint8Array.from(raw) : new Uint8Array(zlib.inflateRawSync(Buffer.from(raw)));
    expect(bytes.length, name).toBe(uncompressed);
    expect(crc32(bytes), name).toBe(crc);

    out.push({ path: name, bytes });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return out;
}

describe("crc32", () => {
  it("agrees with the checksum everything else computes", () => {
    // Against node's, rather than against a value copied from somewhere: a
    // wrong CRC makes an archive that opens and then refuses to extract.
    for (const sample of ["", "a", "The quick brown fox jumps over the lazy dog"]) {
      expect(crc32(text(sample)), sample).toBe(zlib.crc32(sample));
    }
  });
});

describe("archives", () => {
  it("round-trips every entry", async () => {
    const entries = [
      { path: "Songs/A jamais.pro", bytes: text("first") },
      { path: "Songs/Bénis l’Éternel.pro", bytes: text("second") },
    ];
    const read = unzip(await zip(entries));
    expect(read.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(read.map((e) => new TextDecoder().decode(e.bytes))).toEqual(["first", "second"]);
  });

  it("compresses what is worth compressing", async () => {
    // A .pro file is protobuf holding RTF, which is repetitive enough to be
    // worth the browser's deflate. Anything tiny is stored instead, which is
    // an ordinary zip entry rather than a failure.
    const repetitive = text("\\cb3 Que ton nom soit glorifie ".repeat(500));
    const archive = await zip([{ path: "Song.pro", bytes: repetitive }]);
    expect(archive.length).toBeLessThan(repetitive.length / 2);
    expect(unzip(archive)[0].bytes).toEqual(repetitive);
  });

  it("keeps accented names readable", async () => {
    // A real library is full of them, and a zip that mangles the names is a
    // backup nobody can match against their library.
    const name = "Chants/À l’Agneau sur son trône.pro";
    expect(unzip(await zip([{ path: name, bytes: text("x") }]))[0].path).toBe(name);
  });

  it("writes forward slashes and no leading one", async () => {
    const read = unzip(await zip([{ path: "/Chants\\Song.pro", bytes: text("x") }]));
    expect(read[0].path).toBe("Chants/Song.pro");
  });

  it("holds an empty file and an empty archive", async () => {
    expect(unzip(await zip([]))).toEqual([]);
    expect(unzip(await zip([{ path: "empty.pro", bytes: new Uint8Array() }]))[0].bytes).toEqual(
      new Uint8Array()
    );
  });

  it("records the time it was told, not the time it ran", async () => {
    const archive = await zip([{ path: "a", bytes: text("x") }], new Date(2026, 8, 14, 14, 20, 30));
    const view = new DataView(archive.buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (20 << 5) | 15);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (9 << 5) | 14);
  });

  it("refuses more files than the format can index", async () => {
    const many = Array.from({ length: 65536 }, (_, i) => ({ path: `${i}`, bytes: new Uint8Array() }));
    await expect(zip(many)).rejects.toThrow(ZipError);
  });
});

/**
 * The genuinely independent checks.
 *
 * Everything above is this repository reading its own output. These are
 * somebody else's parsers: Info-ZIP verifies the container and every CRC,
 * Python's zipfile extracts it, and between them they are what a reader's
 * machine will do with the backup.
 *
 * The extraction is Python's rather than Info-ZIP's on purpose. Bit 11 says
 * the names are UTF-8, and macOS ships Info-ZIP 6.00 from 2009, which predates
 * the flag and tries to write an accented name as CP437. Modern extractors --
 * Python, 7-Zip, Windows Explorer, macOS's own Archive Utility -- honour it,
 * and a real library is full of accented names, so the flag stays and the
 * older tool is asked only what it can answer.
 */
function tooling(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasUnzip = tooling("unzip");
const hasPython = tooling("python3");

const SAMPLE = [
  { path: "Chants/B\u00e9nis l\u2019\u00c9ternel.pro", bytes: text("\\cb3 B\u00e9nis".repeat(400)) },
  { path: "A jamais.pro", bytes: text("small") },
];

async function writeArchive(): Promise<{ dir: string; archive: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-zip-"));
  const archive = path.join(dir, "backup.zip");
  fs.writeFileSync(archive, await zip(SAMPLE));
  return { dir, archive };
}

describe.skipIf(!hasUnzip)("against Info-ZIP", () => {
  it("passes its integrity check", async () => {
    const { dir, archive } = await writeArchive();
    try {
      expect(execFileSync("unzip", ["-t", archive], { encoding: "utf8" })).toContain("No errors");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasPython)("against Python's zipfile", () => {
  it("extracts the names and the contents that went in", async () => {
    const { dir, archive } = await writeArchive();
    try {
      const out = path.join(dir, "out");
      execFileSync("python3", [
        "-c",
        `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
        archive,
        out,
      ]);
      for (const entry of SAMPLE) {
        expect(new Uint8Array(fs.readFileSync(path.join(out, entry.path))), entry.path).toEqual(
          entry.bytes
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

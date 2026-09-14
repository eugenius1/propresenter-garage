// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Writing a zip file, without a dependency.
 *
 * The backup a reader downloads before anything is written to their library is
 * one artefact holding every file about to change, and a zip is the only
 * container a reader can open on any machine without being told how.
 *
 * Reaching for a library here would have cost about a hundred kilobytes in a
 * bundle whose whole point is to install and work offline, to save about a
 * hundred lines. A zip is a flat container -- a header and the data for each
 * file, then a directory of where they all are -- and the browser already
 * provides the hard part: `CompressionStream("deflate-raw")` is DEFLATE, which
 * is what a zip means by method 8. The only arithmetic left is CRC-32.
 *
 * Nothing here streams. A library of presentations is tens of megabytes and
 * every file is in memory already, so the entries are buffered and the sizes
 * are known before a header is written -- which avoids data descriptors and
 * the flag that goes with them.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;

/** Names are UTF-8, and bit 11 is how a zip says so. */
const UTF8_NAMES = 0x0800;

const STORED = 0;
const DEFLATED = 8;

/** Neither the count nor any offset in a plain zip can exceed these. */
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** The checksum a zip stores for each entry. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Compress with the browser's own DEFLATE, or give up quietly.
 *
 * Returning the original is not a failure: method 0 is a perfectly ordinary
 * zip entry, so a browser without `CompressionStream` -- or a file that
 * compresses to something larger, which small ones do -- simply stores it.
 */
async function deflate(bytes: Uint8Array): Promise<{ method: number; data: Uint8Array }> {
  if (typeof CompressionStream === "undefined") return { method: STORED, data: bytes };

  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    return data.length < bytes.length ? { method: DEFLATED, data } : { method: STORED, data: bytes };
  } catch {
    return { method: STORED, data: bytes };
  }
}

/** MS-DOS date and time, which is what a zip records and all it can record. */
function dosStamp(when: Date): { time: number; date: number } {
  // The format has no room for a year before 1980 and two-second resolution,
  // so seconds are halved and anything earlier is clamped.
  const year = Math.max(1980, when.getFullYear());
  return {
    time:
      (when.getHours() << 11) | (when.getMinutes() << 5) | (Math.floor(when.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** A little-endian writer, which is the only byte order a zip uses. */
class Writer {
  private readonly parts: Uint8Array[] = [];
  length = 0;

  bytes(data: Uint8Array): void {
    this.parts.push(data);
    this.length += data.length;
  }

  short(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  long(value: number): void {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ])
    );
  }

  join(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  path: string;
  bytes: Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

/**
 * Build a zip from files already in hand.
 *
 * `now` is a parameter rather than read from the clock so a test can assert
 * the bytes it produces.
 */
export async function zip(entries: readonly ZipEntry[], now = new Date()): Promise<Uint8Array> {
  if (entries.length > MAX_ENTRIES) throw new ZipError("too many files for one archive");

  const { time, date } = dosStamp(now);
  const encoder = new TextEncoder();
  const out = new Writer();
  const directory: { name: Uint8Array; method: number; crc: number; sizes: [number, number]; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/\\/g, "/").replace(/^\/+/, ""));
    const crc = crc32(entry.bytes);
    const { method, data } = await deflate(entry.bytes);
    const offset = out.length;

    if (offset > MAX_SIZE) throw new ZipError("archive too large");

    out.long(LOCAL_HEADER);
    out.short(20); // the version that understands DEFLATE, which is all we use
    out.short(UTF8_NAMES);
    out.short(method);
    out.short(time);
    out.short(date);
    out.long(crc);
    out.long(data.length);
    out.long(entry.bytes.length);
    out.short(name.length);
    out.short(0); // no extra field
    out.bytes(name);
    out.bytes(data);

    directory.push({ name, method, crc, sizes: [data.length, entry.bytes.length], offset });
  }

  const directoryStart = out.length;

  for (const item of directory) {
    out.long(CENTRAL_HEADER);
    out.short(20); // made by
    out.short(20); // needed to extract
    out.short(UTF8_NAMES);
    out.short(item.method);
    out.short(time);
    out.short(date);
    out.long(item.crc);
    out.long(item.sizes[0]);
    out.long(item.sizes[1]);
    out.short(item.name.length);
    out.short(0); // extra
    out.short(0); // comment
    out.short(0); // first disk
    out.short(0); // internal attributes
    out.long(0); // external attributes
    out.long(item.offset);
    out.bytes(item.name);
  }

  const directorySize = out.length - directoryStart;

  out.long(END_OF_DIRECTORY);
  out.short(0); // this disk
  out.short(0); // the disk the directory starts on
  out.short(directory.length);
  out.short(directory.length);
  out.long(directorySize);
  out.long(directoryStart);
  out.short(0); // no archive comment

  return out.join();
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { checkFidelity, DecodeError, type Fidelity, type RawDoc } from "./decode";
import { buildLibrary, decodeMediaDocument, type MediaLibrary } from "./model";
import type { I18n } from "../i18n/core";

export interface LoadedFile {
  filename: string;
  bytes: number;
  library: MediaLibrary;
  /**
   * The decoded protobuf message.
   *
   * Kept so edits can be applied to the real document rather than rebuilt from
   * `library`, which is a lossy projection of it.
   */
  doc: RawDoc;
  /** The bytes as loaded, kept so the file can be remembered across a refresh. */
  raw: Uint8Array;
  fidelity: Fidelity;
  /** Whether writing this file back out would preserve everything in it. */
  exportSafe: boolean;
}

export async function loadMediaFile(file: File): Promise<LoadedFile> {
  return loadMediaBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

/**
 * Load from bytes rather than a File.
 *
 * Used to restore a file remembered across a refresh, where there is no File
 * object to hand -- only the bytes that were kept.
 */
export function loadMediaBytes(filename: string, buffer: Uint8Array): LoadedFile {
  if (buffer.length === 0) throw new DecodeError("empty");

  const doc = decodeMediaDocument(buffer);
  const { fidelity, exportSafe } = checkFidelity(buffer);

  return {
    filename,
    bytes: buffer.length,
    raw: buffer,
    library: buildLibrary(doc),
    doc,
    fidelity,
    exportSafe,
  };
}

export function formatBytes(n: number, { t, f, num }: I18n): string {
  if (n < 1024) return f(t.units.bytes, { n: num(n) });
  if (n < 1024 * 1024) return f(t.units.kilobytes, { n: num(Math.round(n / 1024)) });
  return f(t.units.megabytes, { n: num(Math.round((n / 1024 / 1024) * 10) / 10) });
}

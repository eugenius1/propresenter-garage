// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syntheticMediaFile } from "./synthetic";

/**
 * Real ProPresenter files are not committed -- they are somebody's actual media
 * library. Point PP_MEDIA_FILE at one to run the round-trip and parity tests.
 *
 * The default is a local copy of an installation kept for development, not an
 * install location: ProPresenter itself lives under ~/Documents/ProPresenter.
 */
export const REAL_FILE =
  process.env.PP_MEDIA_FILE ??
  path.join(os.homedir(), "dev/me/ProPresenter/Playlists/Media");

export const hasRealFile = fs.existsSync(REAL_FILE);

let cached: Uint8Array | undefined;

/**
 * Read the sample file, once per process.
 *
 * Must only be called from inside a test or a `beforeAll` -- never in a
 * `describe` body. Vitest executes suite bodies during collection even for
 * suites that `skipIf` will skip, so a read there throws instead of skipping.
 */
export function readRealFile(): Uint8Array {
  cached ??= new Uint8Array(fs.readFileSync(REAL_FILE));
  return cached;
}

/**
 * The document sources every structural suite runs against.
 *
 * The synthetic fixture always runs, so CI protects the same invariants a
 * developer sees locally. A real ProPresenter file is an extra pass when one is
 * present -- it is the only thing that proves the schema copes with a genuine
 * 482-item library, but it cannot be committed.
 */
export const SOURCES = [
  { name: "synthetic", available: true, read: syntheticMediaFile },
  { name: "real file", available: hasRealFile, read: readRealFile },
] as const;

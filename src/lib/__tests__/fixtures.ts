// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real ProPresenter files are not committed -- they are somebody's actual media
 * library. Point PP_MEDIA_FILE at one to run the round-trip and parity tests.
 */
export const REAL_FILE =
  process.env.PP_MEDIA_FILE ?? path.join(os.homedir(), "dev/me/ProPresenter/Media");

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

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPresentationFile } from "../folder";

/**
 * A folder of real presentations, when one is present.
 *
 * Points at a development copy of an installation, not an install location.
 * Every suite that uses it skips cleanly when there is none, so CI stays green
 * on a machine that has nobody's library on it.
 */
export const REAL_LIBRARY =
  process.env.PP_LIBRARY_DIR ?? path.join(os.homedir(), "dev/me/ProPresenter/Libraries");

export const hasRealLibrary = fs.existsSync(REAL_LIBRARY);

/**
 * Every `.pro` file under the library, subfolders included.
 *
 * Recursive because a real library is organised: the one this was written
 * against keeps three files at the top and 877 more in a `Chants` folder, and
 * a flat listing would have tested the wrong three.
 */
export function libraryFiles(root = REAL_LIBRARY): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) return libraryFiles(full);
      return isPresentationFile(entry.name) ? [full] : [];
    })
    .sort();
}

export function readLibraryFile(file: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(file));
}

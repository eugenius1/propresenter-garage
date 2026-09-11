import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Real ProPresenter files are not committed -- they are a church's actual media
 * library. Point PP_MEDIA_FILE at one to run the round-trip and parity tests.
 */
export const REAL_FILE =
  process.env.PP_MEDIA_FILE ?? path.join(os.homedir(), "dev/me/ProPresenter/Media");

export const hasRealFile = fs.existsSync(REAL_FILE);

export function readRealFile(): Uint8Array {
  return new Uint8Array(fs.readFileSync(REAL_FILE));
}

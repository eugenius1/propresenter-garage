import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isInside, isUnmoved, LibraryError, readFoundFile } from "./library";

/**
 * Writing presentations back over the files ProPresenter owns.
 *
 * This is the disk half of the write path; deciding *what* to write -- the
 * fidelity gate and the read-back of every line -- is `applyFixes()` in core,
 * and it has already run on every byte handed in here. What this adds is
 * what a browser could not do for itself:
 *
 * - **A backup, made and checked first.** Every file about to change is
 *   copied out of the library, flushed, read back and compared before any of
 *   them is touched. One that fails stops the whole run: AGENTS.md's second
 *   guard is a backup of *exactly* the files about to change, and a run that
 *   wrote some without one would break it for those.
 * - **The file is still the one that was planned against.** Re-read and
 *   compared by hash right before it is replaced, because ProPresenter may
 *   have saved over it while a person was reading the confirmation.
 * - **An atomic replace.** The new bytes go to a hidden file beside the
 *   original, flushed, then renamed over it -- which is also how ProPresenter
 *   saves -- so a crash or a full disk leaves the old file or the new one,
 *   never half of either.
 * - **Read back from disk** once replaced, and compared with what was meant.
 */

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Where backups go when nobody says: the platform's own place for an
 * application's data, which is never inside a ProPresenter folder and which
 * no sync or cleanup tool treats as disposable.
 */
export function defaultBackupDir(): string {
  const home = os.homedir();
  const app = "ProPresenter Garage";
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", app, "Backups");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), app, "Backups");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "propresenter-garage", "backups");
}

/**
 * The backup folder, created if need be, refusing one inside a library.
 *
 * Inside a root, every backed-up song would turn up again in listings and
 * searches as a second copy of itself -- and a backup that ProPresenter can
 * see is one it can edit.
 */
export async function openBackupDir(dir: string, roots: readonly string[]): Promise<string> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    throw new LibraryError(`Could not create the backup folder ${dir}: ${(e as NodeJS.ErrnoException).code ?? e}`);
  }
  const real = await fs.realpath(dir);
  if (roots.some((root) => root === real || isInside(root, real))) {
    throw new LibraryError(
      `The backup folder ${real} is inside a library folder. Choose one outside them with --backup-dir.`
    );
  }
  return real;
}

/** One file to replace: the bytes it was planned against, and the bytes to write. */
export interface Replacement {
  /** A real path inside the roots, as `resolveInRoots` gave it. */
  path: string;
  /** The file as the change was planned against it, just read and checked by the caller. This is what is backed up. */
  original: Uint8Array;
  updated: Uint8Array;
}

/**
 * Why a file was left alone.
 *
 * - `stale`: it no longer holds what the change was planned against -- the
 *   same word `applyFixes` uses for the same thing.
 * - `moved`: it is no longer reached without a symlink, or is outside the roots.
 * - `backupFailed`: a backup could not be made and checked, so nothing was written.
 * - `writeFailed`: the folder would not take the new file; the original is untouched.
 * - `readBackFailed`: the file on disk does not hold what was written. The backup has the original.
 */
export type WriteRefusal = "stale" | "moved" | "backupFailed" | "writeFailed" | "readBackFailed";

export interface WriteOutcome {
  path: string;
  written: boolean;
  /** Where this file's backup is, when one was made. */
  backup?: string;
  reason?: WriteRefusal;
  detail?: string;
}

export interface WriteRun {
  /** The dated folder this run's backups are in, if any file got that far. */
  backupFolder?: string;
  /** One per replacement, in the order given. */
  outcomes: WriteOutcome[];
}

/** A folder name for this run that sorts by time and does not collide with an earlier one. */
async function runFolder(backupDir: string, now: Date): Promise<string> {
  const stamp = now.toISOString().replace(/:/g, "-").replace(/\..*$/, "");
  for (let n = 1; ; n++) {
    const candidate = path.join(backupDir, n === 1 ? stamp : `${stamp} (${n})`);
    try {
      await fs.mkdir(candidate);
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** Where in the backup a file goes: its root's name, then its path within that root, so a restore is a copy back. */
function backupPath(folder: string, roots: readonly string[], file: string): string {
  const root = roots.find((r) => isInside(r, file))!;
  return path.join(folder, path.basename(root), path.relative(root, file));
}

/** Write a new file, refusing to follow or replace anything already there, and flush it. */
async function writeNew(file: string, bytes: Uint8Array, mode = 0o644): Promise<void> {
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(file, flags, mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

const errorDetail = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;

/** Why the file can no longer be replaced as planned, or nothing if it still can. */
async function stillPlanned(roots: readonly string[], r: Replacement): Promise<Pick<WriteOutcome, "reason" | "detail"> | undefined> {
  if (!roots.some((root) => isInside(root, r.path)) || !(await isUnmoved(r.path))) return { reason: "moved" };
  try {
    return same((await readFoundFile(r.path)).bytes, r.original) ? undefined : { reason: "stale" };
  } catch (e) {
    return { reason: "stale", detail: errorDetail(e) };
  }
}

/**
 * Back up, then replace, each file.
 *
 * Every file is backed up before any is written, so a run that cannot back
 * up one file writes none: a person told "a backup is made first" should
 * never find a changed song that is not in it. The caller has just read and
 * checked each `original`; each is checked again right before it is replaced.
 */
export async function replaceWithBackup(
  roots: readonly string[],
  backupDir: string,
  replacements: readonly Replacement[],
  now = new Date()
): Promise<WriteRun> {
  if (replacements.length === 0) return { outcomes: [] };

  let backupFolder: string | undefined;
  const backups: string[] = [];
  try {
    backupFolder = await runFolder(backupDir, now);
    for (const r of replacements) {
      const copy = backupPath(backupFolder, roots, r.path);
      await fs.mkdir(path.dirname(copy), { recursive: true });
      await writeNew(copy, r.original);
      if (!same(await fs.readFile(copy), r.original)) throw new Error(`${copy} did not read back`);
      backups.push(copy);
    }
  } catch (e) {
    const detail = errorDetail(e);
    return {
      backupFolder,
      outcomes: replacements.map((r) => ({ path: r.path, written: false, reason: "backupFailed", detail })),
    };
  }

  const outcomes: WriteOutcome[] = [];
  for (const [i, r] of replacements.entries()) {
    outcomes.push({ path: r.path, backup: backups[i], ...(await replaceOne(roots, r)) });
  }
  return { backupFolder, outcomes };
}

async function replaceOne(roots: readonly string[], r: Replacement): Promise<Pick<WriteOutcome, "written" | "reason" | "detail">> {
  // Again, right before the rename: the backup took time, and ProPresenter
  // saves whenever it likes.
  const refused = await stillPlanned(roots, r);
  if (refused) return { written: false, ...refused };

  const dir = path.dirname(r.path);
  // Hidden, so a listing caught mid-write never shows it as a presentation.
  const temp = path.join(dir, `.${path.basename(r.path)}.${randomBytes(6).toString("hex")}.garage-tmp`);
  try {
    const { mode } = await fs.stat(r.path);
    await writeNew(temp, r.updated, mode & 0o777);
    await fs.rename(temp, r.path);
  } catch (e) {
    await fs.rm(temp, { force: true });
    return { written: false, reason: "writeFailed", detail: errorDetail(e) };
  }

  try {
    if (same((await readFoundFile(r.path)).bytes, r.updated)) return { written: true };
    return { written: true, reason: "readBackFailed" };
  } catch (e) {
    return { written: true, reason: "readBackFailed", detail: errorDetail(e) };
  }
}

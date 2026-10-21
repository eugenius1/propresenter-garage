import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isPresentationFile } from "../lib/folder";

/**
 * The folders the server may read, and nothing outside them.
 *
 * Paths arrive from a model, which will happily ask for `../../.ssh/id_rsa` if
 * a prompt talks it into it. So every path is resolved to its real location --
 * symlinks followed -- before it is compared with the roots, and the roots
 * themselves are resolved once at start-up for the same reason.
 *
 * Read-only by construction: nothing in this module opens a file for writing.
 * The write path for presentations has four guards (AGENTS.md); a server that
 * cannot write needs none of them, and that is the point of this phase.
 */

/** Larger than any real library file by a wide margin, small enough to refuse a disk image. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Enough for a big church library several times over; a stop for a root pointed at `/`. */
export const MAX_WALK_FILES = 20_000;

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryError";
  }
}

/** Resolve the configured roots, refusing any that is not a readable folder. */
export async function openRoots(dirs: readonly string[]): Promise<string[]> {
  if (dirs.length === 0) throw new LibraryError("No library folder configured.");
  const roots: string[] = [];
  for (const dir of dirs) {
    let real: string;
    try {
      real = await fs.realpath(dir);
    } catch {
      throw new LibraryError(`Library folder not found: ${dir}`);
    }
    if (!(await fs.stat(real)).isDirectory()) {
      throw new LibraryError(`Not a folder: ${dir}`);
    }
    roots.push(real);
  }
  return roots;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Turn a path from a tool call into a real path inside one of the roots.
 *
 * A relative path is tried against each root in order, so a model can pass
 * back exactly what a listing showed it. Containment is checked after
 * `realpath`, never before: checking the string first is what lets a symlink
 * inside the library point somewhere it should not.
 */
export async function resolveInRoots(roots: readonly string[], p: string): Promise<string> {
  const candidates = path.isAbsolute(p) ? [p] : roots.map((root) => path.join(root, p));
  let outside = false;
  for (const candidate of candidates) {
    let real: string;
    try {
      real = await fs.realpath(candidate);
    } catch {
      continue;
    }
    if (roots.some((root) => isInside(root, real))) return real;
    // Another root may still hold the same relative path legitimately.
    outside = true;
  }
  throw new LibraryError(
    outside ? `Outside the configured library folders: ${p}` : `Not found in the configured library folders: ${p}`
  );
}

/**
 * Read a file the walk below found, refusing anything absurdly large.
 *
 * No `realpath` here: the walk starts at resolved roots and never follows a
 * symlink, so what it finds is inside them already. Opened with `O_NOFOLLOW`
 * so a file swapped for a symlink after the walk is refused rather than
 * followed, and sized from the open handle so the cap is checked before
 * anything is read. Paths a model supplies go through `readLibraryFile`.
 *
 * Every failure comes back as a `LibraryError`, because to a caller scanning
 * a library one unreadable file is a finding about that file, not a crash.
 */
export async function readFoundFile(file: string): Promise<Uint8Array> {
  let handle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new LibraryError(`Not a file: ${file}`);
    if (stat.size > MAX_FILE_BYTES) throw new LibraryError(`Too large to be a ProPresenter file: ${file}`);
    return await handle.readFile();
  } catch (e) {
    if (e instanceof LibraryError) throw e;
    throw new LibraryError(`Could not read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  } finally {
    await handle?.close();
  }
}

/** Read one file from inside the roots, refusing anything absurdly large. */
export async function readLibraryFile(roots: readonly string[], p: string): Promise<{ path: string; bytes: Uint8Array }> {
  const real = await resolveInRoots(roots, p);
  return { path: real, bytes: await readFoundFile(real) };
}

/** A folder inside the roots, for tools that take one. */
export async function resolveFolder(roots: readonly string[], p: string): Promise<string> {
  const real = await resolveInRoots(roots, p);
  if (!(await fs.stat(real)).isDirectory()) throw new LibraryError(`Not a folder: ${p}`);
  return real;
}

/**
 * Every presentation under the given folders, in a stable order.
 *
 * Symlinked folders are not followed. A library has no reason to contain one,
 * and following them is how a walk escapes its root or loops forever. Which
 * files count is `isPresentationFile`, the rule the browser's folder scan uses.
 */
export async function findPresentations(dirs: readonly string[]): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const pending = [...dirs];

  while (pending.length > 0) {
    const dir = pending.shift()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        pending.push(full);
      } else if (entry.isFile() && isPresentationFile(entry.name)) {
        files.push(full);
        if (files.length >= MAX_WALK_FILES) return { files, truncated: true };
      }
    }
  }

  return { files, truncated: false };
}

/**
 * The media bin, found where ProPresenter keeps it.
 *
 * `Playlists/Media` inside the ProPresenter folder. Looked for under each root
 * and one level down, so pointing the server at either the ProPresenter folder
 * or the folder above it finds the same file.
 */
export async function findMediaBin(roots: readonly string[]): Promise<string | undefined> {
  for (const root of roots) {
    const candidates = [path.join(root, "Playlists", "Media"), path.join(root, "ProPresenter", "Playlists", "Media")];
    for (const candidate of candidates) {
      const stat = await fs.stat(candidate).catch(() => undefined);
      if (stat?.isFile()) return candidate;
    }
  }
  return undefined;
}

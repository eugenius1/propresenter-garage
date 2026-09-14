// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Reading a folder of ProPresenter files.
 *
 * Two routes, because they differ in what they can do rather than merely in
 * how they look:
 *
 * - The File System Access API (`showDirectoryPicker`) gives a handle that can
 *   be read *and written*, and kept between visits. Chrome and Edge only --
 *   Safari and Firefox implement no directory picker at all, only the
 *   origin-private file system, which cannot see real folders.
 * - `<input type="file" webkitdirectory>` reads a folder anywhere, including
 *   Safari and Firefox, but hands over plain copies: there is no way back to
 *   the originals, so nothing can be written.
 *
 * So every browser can scan and report. Only Chromium can save a fix in place.
 *
 * Installing the app changes neither: it changes how long permission lasts.
 * In a tab, access ends when the last tab for the origin closes. Installed,
 * Chrome persists it, so the folder is granted once rather than every session.
 */

export type FolderAccess = "readwrite" | "readonly" | "unavailable";

/** What this browser can do with a folder, before anything is picked. */
export function folderAccess(): FolderAccess {
  if (typeof window === "undefined") return "unavailable";
  if ("showDirectoryPicker" in window) return "readwrite";
  // Feature-detect the directory input rather than sniffing the browser.
  if (typeof document !== "undefined" && "webkitdirectory" in document.createElement("input")) {
    return "readonly";
  }
  return "unavailable";
}

export interface FolderFile {
  /** Path relative to the chosen folder, e.g. "Libraries/Song.pro". */
  path: string;
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
  /** Absent when the folder was read through the input fallback. */
  write?: (bytes: Uint8Array) => Promise<void>;
}

export interface PickedFolder {
  name: string;
  files: FolderFile[];
  /** Whether anything in this folder can be written back. */
  writable: boolean;
  /**
   * The directory handle, when there was one.
   *
   * Kept so the folder can be remembered across a refresh: a handle is
   * structured-cloneable, so it survives in IndexedDB as a live handle rather
   * than a description of a path.
   */
  handle?: unknown;
}

/** Directories that never hold documents, skipped to keep scans quick. */
const SKIP_DIRECTORIES = new Set(["Media", "Assets", "Cache", "Thumbnails", ".git"]);

type AnyHandle = {
  kind: "file" | "directory";
  name: string;
  values?: () => AsyncIterable<AnyHandle>;
  getFile?: () => Promise<File>;
  createWritable?: () => Promise<{ write: (d: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
};

async function walkHandle(
  directory: AnyHandle,
  prefix: string,
  out: FolderFile[],
  matches: (name: string) => boolean
): Promise<void> {
  for await (const entry of directory.values!()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await walkHandle(entry, path, out, matches);
      continue;
    }

    if (!matches(entry.name)) continue;

    out.push({
      path,
      name: entry.name,
      size: 0,
      read: async () => new Uint8Array(await (await entry.getFile!()).arrayBuffer()),
      write: entry.createWritable
        ? async (bytes) => {
            const writable = await entry.createWritable!();
            await writable.write(bytes);
            await writable.close();
          }
        : undefined,
    });
  }
}

/**
 * Ask for a folder, and confirm we may write to it.
 *
 * Returns null when the reader dismisses the picker, which is not an error.
 * `mode: "readwrite"` is requested up front so the reader answers one prompt
 * rather than being asked again the moment a fix is saved.
 */
export async function pickFolder(
  matches: (name: string) => boolean,
  { write = false }: { write?: boolean } = {}
): Promise<PickedFolder | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<AnyHandle> })
    .showDirectoryPicker;
  if (!picker) return null;

  let handle: AnyHandle;
  try {
    handle = await picker({ id: "propresenter", mode: write ? "readwrite" : "read" });
  } catch (e) {
    // AbortError is the reader closing the dialog; anything else is real.
    if ((e as Error).name === "AbortError") return null;
    throw e;
  }

  let writable = false;
  if (write && handle.requestPermission) {
    writable = (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  }

  return readFolderHandle(handle, matches, writable);
}

/**
 * Walk a directory handle that is already in hand.
 *
 * Separate from picking so a remembered handle can be reopened without showing
 * the picker again.
 */
export async function readFolderHandle(
  handle: unknown,
  matches: (name: string) => boolean,
  writable = false
): Promise<PickedFolder> {
  const directory = handle as AnyHandle;
  const files: FolderFile[] = [];
  await walkHandle(directory, "", files, matches);
  return { name: directory.name, files, writable, handle };
}

/**
 * Read a folder through a directory input.
 *
 * The fallback for browsers without the picker. Files arrive as copies, so the
 * result is never writable.
 */
export function readFolderFromInput(
  fileList: FileList,
  matches: (name: string) => boolean
): PickedFolder {
  const files: FolderFile[] = [];
  let root = "";

  for (const file of Array.from(fileList)) {
    // webkitRelativePath is "<folder>/<...>/<name>"; the first segment names
    // the folder the reader chose.
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    const segments = relative.split("/");
    if (!root && segments.length > 1) root = segments[0];

    const withinRoot = segments.slice(1);
    if (withinRoot.some((segment) => SKIP_DIRECTORIES.has(segment))) continue;
    if (!matches(file.name)) continue;

    files.push({
      path: withinRoot.join("/") || file.name,
      name: file.name,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    });
  }

  return { name: root || "", files, writable: false };
}

/**
 * The presentations in a ProPresenter workspace.
 *
 * Dotfiles are not presentations, whatever they are named. A real library
 * turned up a 51 KB file called `.pro` that decodes to a presentation with no
 * slides in it, and macOS scatters `._Song.pro` resource forks across any
 * folder that has been near a USB stick -- those decode to nothing at all and
 * would each be reported as a file that could not be read.
 */
export const isPresentationFile = (name: string) =>
  !name.startsWith(".") && name.toLowerCase().endsWith(".pro");

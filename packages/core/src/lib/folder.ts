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
  createWritable?: () => Promise<{
    write: (d: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  }>;
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
            try {
              await writable.write(bytes);
            } catch (e) {
              // Abandon the swap file rather than leave it holding the file's
              // lock until it is collected: the original is untouched until
              // close(), so aborting is what keeps it that way, and a retry
              // in the same session would otherwise find the file busy.
              await writable.abort?.().catch(() => {});
              throw e;
            }
            await writable.close();
          }
        : undefined,
    });
  }
}

/**
 * A folder that was picked and then could not be read.
 *
 * Distinct from a picker that failed, which a caller can fall back from: this
 * folder was chosen, so offering a different way to choose it misses the point.
 */
export class FolderReadError extends Error {
  constructor(cause: unknown) {
    super((cause as Error)?.message ?? String(cause), { cause });
    this.name = "FolderReadError";
  }
}

/**
 * Ask for a folder to read.
 *
 * Returns null when the reader dismisses the picker, which is not an error.
 * Only read access is asked for here; writing is asked for when a fix is
 * saved, where the reader can see why.
 */
export async function pickFolder(
  matches: (name: string) => boolean
): Promise<PickedFolder | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: unknown) => Promise<AnyHandle> })
    .showDirectoryPicker;
  if (!picker) return null;

  let handle: AnyHandle;
  try {
    handle = await picker({ id: "propresenter", mode: "read" });
  } catch (e) {
    // AbortError is the reader closing the dialog; anything else is real.
    if ((e as Error).name === "AbortError") return null;
    throw e;
  }

  try {
    return await readFolderHandle(handle, matches);
  } catch (e) {
    throw new FolderReadError(e);
  }
}

/**
 * Walk a directory handle that is already in hand.
 *
 * Separate from picking so a remembered handle can be reopened without showing
 * the picker again.
 */
export async function readFolderHandle(
  handle: unknown,
  matches: (name: string) => boolean
): Promise<PickedFolder> {
  const directory = handle as AnyHandle;
  const files: FolderFile[] = [];
  await walkHandle(directory, "", files, matches);
  return { name: directory.name, files, handle };
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

  return { name: root || "", files };
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

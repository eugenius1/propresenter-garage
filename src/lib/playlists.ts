import { decodeDocument, messageType, type RawDoc } from "./decode";
import { rawItems, walkNodes } from "./model";

/**
 * Building the entries of a presentation playlist: the `Playlists/Library`
 * document, as opposed to the media bin's `Playlists/Media`.
 *
 * Edits themselves are the media bin's operations, which work on either
 * document; what this adds is the entries only a presentation playlist holds.
 * A presentation is referenced by path, a header is a coloured divider, and a
 * media entry is the same cue the media bin holds -- so it is copied from
 * there rather than built from a file name.
 *
 * Nothing here writes. Like every export, the result is a differently named
 * file the reader moves into place while ProPresenter is closed: it keeps the
 * open document in memory and writes it back on quit.
 */

const PlaylistItem = messageType("rv.data.PlaylistItem");

export function decodePlaylistsDocument(bytes: Uint8Array): RawDoc {
  return decodeDocument(bytes, "presentation");
}

/** Where ProPresenter's own folder sits, so a path can be made absolute. */
export interface ShowLocation {
  /** The ProPresenter folder, e.g. `/Users/me/Documents/ProPresenter`. */
  root: string;
  platform: "PLATFORM_MACOS" | "PLATFORM_WIN32";
}

/**
 * Where the document's existing entries say the ProPresenter folder is.
 *
 * Every entry stores its path twice, absolutely and relative to that folder,
 * so the folder is the one minus the other. The browser never learns a real
 * path, and an entry made without one would carry only its relative half --
 * which ProPresenter resolves, but which no other entry it writes lacks.
 */
export function showLocationOf(doc: RawDoc): ShowLocation | undefined {
  for (const item of walkNodes((doc as any).root_node).flatMap(rawItems)) {
    const url = item.presentation?.document_path;
    const relative: string | undefined = url?.local?.path;
    if (!url?.absolute_string || !relative || url.local.root !== rootShow()) continue;

    const absolute = url.platform === platformValue("PLATFORM_WIN32")
      ? url.absolute_string
      : safeDecode(url.absolute_string.replace(/^file:\/\//, ""));
    const tail = url.platform === platformValue("PLATFORM_WIN32")
      ? relative.replace(/\//g, "\\")
      : relative;
    if (absolute?.endsWith(tail)) {
      return {
        root: absolute.slice(0, absolute.length - tail.length).replace(/[\\/]$/, ""),
        platform: url.platform === platformValue("PLATFORM_WIN32") ? "PLATFORM_WIN32" : "PLATFORM_MACOS",
      };
    }
  }
  return undefined;
}

function safeDecode(uri: string): string | undefined {
  try {
    return decodeURI(uri);
  } catch {
    return undefined;
  }
}

function rootShow(): number {
  return messageType("rv.data.URL").lookupEnum("LocalRelativePath.Root").values.ROOT_SHOW;
}

function platformValue(name: ShowLocation["platform"]): number {
  return messageType("rv.data.URL").lookupEnum("Platform").values[name];
}

function newUuid(): { string: string } {
  return { string: crypto.randomUUID().toUpperCase() };
}

/**
 * A file URL the way ProPresenter writes one on a Mac.
 *
 * Decomposed Unicode, because that is what macOS hands back for a file name
 * and what every entry ProPresenter wrote itself carries -- "Gloire à ton nom"
 * is stored with the accent as a separate character. `encodeURI` then matches
 * its escaping: spaces and accents escaped, commas and brackets left alone.
 */
function macFileUrl(path: string): string {
  return `file://${encodeURI(path.normalize("NFD")).replace(/[?#]/g, encodeURIComponent)}`;
}

export interface PresentationEntryOptions {
  /** Relative to the ProPresenter folder, e.g. `Libraries/Chants/Majeste.pro`. */
  path: string;
  /**
   * Shown in the playlist; the file name without `.pro` when omitted.
   *
   * Taken from the file name, it keeps the file name's Unicode form, as
   * ProPresenter's own entries do.
   */
  name?: string;
  /** Usually {@link showLocationOf} the document it is going into. */
  location?: ShowLocation;
}

/** A playlist entry that plays a presentation from the library. */
export function presentationEntry(options: PresentationEntryOptions): RawDoc {
  const path = options.path.replace(/\\/g, "/");
  const location = options.location;
  const mac = location?.platform !== "PLATFORM_WIN32";
  const relative = mac ? path.normalize("NFD") : path;
  const name = options.name ?? (relative.split("/").pop() ?? relative).replace(/\.pro$/i, "");

  let absolute: string | undefined;
  if (location) {
    absolute = mac
      ? macFileUrl(`${location.root}/${path}`)
      : `${location.root}\\${path.replace(/\//g, "\\")}`;
  }

  return PlaylistItem.fromObject({
    uuid: newUuid(),
    name,
    presentation: {
      document_path: {
        ...(absolute ? { absolute_string: absolute } : {}),
        platform: location?.platform ?? "PLATFORM_MACOS",
        local: { root: "ROOT_SHOW", path: relative },
      },
    },
  }) as RawDoc;
}

/** A coloured divider, as ProPresenter draws between sections of a service. */
export function headerEntry(
  name: string,
  color: { red?: number; green?: number; blue?: number; alpha?: number } = { alpha: 1 }
): RawDoc {
  return PlaylistItem.fromObject({ uuid: newUuid(), name, header: { color } }) as RawDoc;
}

/**
 * A media entry, copied from one in the media bin.
 *
 * The cue is taken whole, so the media keeps everything the bin had set on it
 * -- effects, cropping, playback -- and gets identities of its own: the same
 * uuids in two documents would make them one item as far as any later
 * comparison is concerned.
 */
export function mediaEntry(fromMediaBin: unknown): RawDoc {
  const copy = PlaylistItem.decode(PlaylistItem.encode(fromMediaBin as never).finish()) as any;
  if (!copy.cue) throw new Error("not a media entry: it holds no cue");
  copy.uuid = newUuid();
  copy.cue.uuid = newUuid();
  for (const action of copy.cue.actions ?? []) action.uuid = newUuid();
  return copy;
}

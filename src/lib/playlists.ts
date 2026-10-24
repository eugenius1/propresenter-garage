import { decodeDocument, enumLabel, messageType, newUuid, wireCopy, type RawDoc } from "./decode";
import { basename, LOCAL_ROOT, rawItems, walkNodes } from "./model";

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
    if (!url?.absolute_string || !relative) continue;
    if (enumLabel(LOCAL_ROOT, url.local.root) !== "SHOW") continue;

    const windows = enumLabel("rv.data.URL.Platform", url.platform) === "WIN32";
    const absolute = windows
      ? url.absolute_string
      : safeDecode(url.absolute_string.replace(/^file:\/\//, ""));
    const tail = windows ? toWindows(relative) : relative;
    if (absolute?.endsWith(tail)) {
      return {
        root: absolute.slice(0, absolute.length - tail.length).replace(/[\\/]$/, ""),
        platform: windows ? "PLATFORM_WIN32" : "PLATFORM_MACOS",
      };
    }
  }
  return undefined;
}

/**
 * A file URL's path, every escape undone.
 *
 * `decodeURIComponent` rather than `decodeURI`: the latter leaves `%23` and
 * `%3F` as they are, so an entry for "Hymne #1.pro" -- written that way by
 * {@link presentationEntry} itself -- would never match its relative path.
 */
function safeDecode(uri: string): string | undefined {
  try {
    return decodeURIComponent(uri);
  } catch {
    return undefined;
  }
}

const toWindows = (path: string) => path.replace(/\//g, "\\");

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
  const location = options.location;
  const mac = location?.platform !== "PLATFORM_WIN32";
  // A backslash is a separator only on Windows; on a Mac it is part of the name.
  const path = mac ? options.path : options.path.replace(/\\/g, "/");
  const relative = mac ? path.normalize("NFD") : path;
  const name = options.name ?? basename(relative).replace(/\.pro$/i, "");
  const absolute = !location
    ? undefined
    : mac
      ? macFileUrl(`${location.root}/${path}`)
      : `${location.root}\\${toWindows(path)}`;

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
  const copy = wireCopy(PlaylistItem, fromMediaBin);
  if (!copy.cue) throw new Error("not a media entry: it holds no cue");
  copy.uuid = newUuid();
  copy.cue.uuid = newUuid();
  for (const action of copy.cue.actions ?? []) action.uuid = newUuid();
  return copy;
}

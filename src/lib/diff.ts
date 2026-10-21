import { groupBy } from "./collections";
import { itemPath, type MediaItem, type MediaLibrary, type ModDescriptor, type PlaybackSettings } from "./model";

/**
 * Diff two media-bin snapshots.
 *
 * Matching runs in two passes. First on item UUID, which ProPresenter keeps
 * stable across edits -- that is what lets the diff say "moved" or "renamed"
 * instead of degrading into a wall of delete+add. Items that fail to match by
 * UUID get a second pass on the normalised media key, which catches media
 * re-added by hand (a fresh UUID pointing at the same file).
 *
 * Change details are returned as structured data rather than sentences, so the
 * interface can render them in any language.
 */

export type ChangeType =
  | "added"
  | "removed"
  | "moved"
  | "renamed"
  | "retimed"
  | "restyled"
  | "relinked";

export type PlaybackKey = keyof PlaybackSettings;

export interface PlaybackDelta {
  key: PlaybackKey;
  from: unknown;
  to: unknown;
}

export interface PlaybackValue {
  key: PlaybackKey;
  value: unknown;
}

/** What actually changed, described in data the view formats as it sees fit. */
export type ChangeDetail =
  /** Added or removed: which playlist, and how it was set up. */
  | { kind: "presence"; playlist: string; playback: PlaybackValue[] }
  /** Moved between playlists. */
  | { kind: "move"; from: string; to: string }
  /** Label changed in ProPresenter. */
  | { kind: "rename"; from: string; to: string }
  /** Same item, different underlying file. */
  | { kind: "relink"; from: string; to: string }
  /** Playback or transition settings changed. */
  | { kind: "playback"; deltas: PlaybackDelta[] }
  /** Mirroring, crop or effects changed. */
  | { kind: "mods"; from: ModDescriptor[]; to: ModDescriptor[] };

export interface Change {
  type: ChangeType;
  item: MediaItem;
  before?: MediaItem;
  detail: ChangeDetail;
  /** True when the pair was matched on media path rather than UUID. */
  fuzzy?: boolean;
}

export interface PlaylistChange {
  type: "added" | "removed" | "renamed" | "recreated";
  /**
   * The playlist's own identity, so a merge can act on it.
   *
   * For a recreation the two sides have different uuids by definition; this is
   * the one the playlist carries on the side it still exists.
   */
  uuid: string;
  /** Full ancestry, for display. */
  path: string;
  /** The node's own name, which is what a rename actually changes. */
  name: string;
  /** Only set for renames: the previous path and name. */
  from?: string;
  fromName?: string;
  /**
   * Only set for a rename that is really a move to another parent, with or
   * without a new name -- which a merge cannot yet bring across.
   */
  reparented?: boolean;
  /** Only set for recreations: how many items each version held. */
  itemsBefore?: number;
  itemsAfter?: number;
}

export interface DiffResult {
  changes: Change[];
  playlistChanges: PlaylistChange[];
  counts: Record<ChangeType, number>;
  left: MediaLibrary;
  right: MediaLibrary;
}

const PLAYBACK_KEYS: PlaybackKey[] = [
  "transitionDuration",
  "playbackBehavior",
  "endBehavior",
  "timesToLoop",
  "loopTime",
  "softLoop",
  "markerCount",
  "effectCount",
];

/** Treat absent, zero and false as equivalent -- proto3 omits default values. */
function normalise(v: unknown): unknown {
  if (v === undefined || v === null || v === 0 || v === false) return undefined;
  return v;
}

function playbackValues(p: PlaybackSettings): PlaybackValue[] {
  return PLAYBACK_KEYS.filter((k) => normalise(p[k]) !== undefined).map((key) => ({
    key,
    value: p[key],
  }));
}

/**
 * Effects are counted among the playback settings for display, but a change
 * to them is a restyle: the fingerprint already sees the effect itself, so
 * counting it here as well reported one edit twice.
 */
const RETIMING_KEYS = PLAYBACK_KEYS.filter((k) => k !== "effectCount");

function playbackDeltas(a: PlaybackSettings, b: PlaybackSettings): PlaybackDelta[] {
  return RETIMING_KEYS.filter((k) => normalise(a[k]) !== normalise(b[k])).map((key) => ({
    key,
    from: a[key],
    to: b[key],
  }));
}

// An empty uuid or key identifies nothing, so it must never pair two items.
function indexBy<T>(rows: T[], pick: (row: T) => string): Map<string, T[]> {
  return groupBy(rows.filter((row) => pick(row)), pick);
}

/**
 * Decide whether an item actually changed playlist.
 *
 * Compares the holding playlist's UUID, not its path. Renaming a playlist
 * rewrites the path of every item inside it, so a path comparison reports a
 * rename of one playlist as a move of all its contents -- 22 spurious "moved"
 * rows for a single rename, in one observed case. The UUID survives renames,
 * so only genuine relocations are reported. Paths are still what gets shown.
 */
function movedPlaylist(before: MediaItem, after: MediaItem): boolean {
  if (before.playlistUuid && after.playlistUuid) {
    return before.playlistUuid !== after.playlistUuid;
  }
  return before.playlistPath !== after.playlistPath;
}

export function diffLibraries(left: MediaLibrary, right: MediaLibrary): DiffResult {
  const changes: Change[] = [];
  const matchedLeft = new Set<MediaItem>();
  const matchedRight = new Set<MediaItem>();

  const compare = (before: MediaItem, after: MediaItem, fuzzy: boolean) => {
    matchedLeft.add(before);
    matchedRight.add(after);

    if (before.key !== after.key) {
      changes.push({
        type: "relinked",
        item: after,
        before,
        fuzzy,
        detail: { kind: "relink", from: itemPath(before), to: itemPath(after) },
      });
    }
    if (movedPlaylist(before, after)) {
      changes.push({
        type: "moved",
        item: after,
        before,
        fuzzy,
        detail: { kind: "move", from: before.playlistPath, to: after.playlistPath },
      });
    }
    if (before.name !== after.name) {
      changes.push({
        type: "renamed",
        item: after,
        before,
        fuzzy,
        detail: { kind: "rename", from: before.name, to: after.name },
      });
    }
    const deltas = playbackDeltas(before.playback, after.playback);
    if (deltas.length) {
      changes.push({
        type: "retimed",
        item: after,
        before,
        fuzzy,
        detail: { kind: "playback", deltas },
      });
    }
    if (before.modifications.fingerprint !== after.modifications.fingerprint) {
      changes.push({
        type: "restyled",
        item: after,
        before,
        fuzzy,
        detail: {
          kind: "mods",
          from: before.modifications.descriptors,
          to: after.modifications.descriptors,
        },
      });
    }
  };

  // Pass 1 -- UUID.
  const rightByUuid = indexBy(right.items, (i) => i.uuid);
  for (const before of left.items) {
    const candidates = rightByUuid.get(before.uuid);
    if (!candidates?.length) continue;
    const after = candidates.find((c) => !matchedRight.has(c));
    if (after) compare(before, after, false);
  }

  // Pass 2 -- media path, for items re-added with a fresh UUID.
  const unmatchedRightByKey = indexBy(
    right.items.filter((i) => !matchedRight.has(i)),
    (i) => i.key
  );
  for (const before of left.items) {
    if (matchedLeft.has(before)) continue;
    const candidates = unmatchedRightByKey.get(before.key);
    const after = candidates?.find((c) => !matchedRight.has(c));
    if (after) compare(before, after, true);
  }

  for (const before of left.items) {
    if (!matchedLeft.has(before)) {
      changes.push({
        type: "removed",
        item: before,
        detail: {
          kind: "presence",
          playlist: before.playlistPath,
          playback: playbackValues(before.playback),
        },
      });
    }
  }
  for (const after of right.items) {
    if (!matchedRight.has(after)) {
      changes.push({
        type: "added",
        item: after,
        detail: {
          kind: "presence",
          playlist: after.playlistPath,
          playback: playbackValues(after.playback),
        },
      });
    }
  }

  const counts = {
    added: 0, removed: 0, moved: 0, renamed: 0, retimed: 0, restyled: 0, relinked: 0,
  } as Record<ChangeType, number>;
  for (const c of changes) counts[c.type]++;

  return {
    changes,
    playlistChanges: diffPlaylists(left, right),
    counts,
    left,
    right,
  };
}

function diffPlaylists(left: MediaLibrary, right: MediaLibrary): PlaylistChange[] {
  const flatten = (lib: MediaLibrary) => {
    const byUuid = new Map<
      string,
      { path: string; name: string; parent: string; items: number }
    >();
    const walk = (n: typeof lib.root, parent: string) => {
      if (n.kind !== "root" && n.uuid) {
        byUuid.set(n.uuid, { path: n.path, name: n.name, parent, items: n.items.length });
      }
      for (const child of n.children) walk(child, n.kind === "root" ? "" : n.uuid);
    };
    walk(lib.root, "");
    return byUuid;
  };

  const before = flatten(left);
  const after = flatten(right);

  const removed: PlaylistChange[] = [];
  const added: PlaylistChange[] = [];
  const out: PlaylistChange[] = [];

  for (const [uuid, node] of before) {
    const now = after.get(uuid);
    if (now === undefined) {
      removed.push({ type: "removed", uuid, path: node.path, name: node.name });
    } else if (now.name !== node.name || now.parent !== node.parent) {
      // Its own name or its own place, not its path: renaming a group changes
      // the path of everything inside it, and those have not changed at all.
      out.push({
        type: "renamed",
        uuid,
        path: now.path,
        name: now.name,
        from: node.path,
        fromName: node.name,
        ...(now.parent !== node.parent && { reparented: true }),
      });
    }
  }
  for (const [uuid, node] of after) {
    if (!before.has(uuid)) added.push({ type: "added", uuid, path: node.path, name: node.name });
  }

  // A playlist deleted and made again in ProPresenter gets a fresh uuid, so by
  // identity it is a removal and an addition. Reporting it as both, on adjacent
  // lines naming the same path, reads as a glitch -- so pair them up.
  // Several per path, since siblings can share a name.
  const addedByPath = groupBy(added, (change) => change.path);
  const pairedAdds = new Set<PlaylistChange>();

  for (const change of removed) {
    const twin = addedByPath.get(change.path)?.find((c) => !pairedAdds.has(c));
    if (twin) {
      pairedAdds.add(twin);
      // The pair's own uuids, not the first playlist found at that path: a
      // sibling of the same name that was left alone has the same path too.
      out.push({
        type: "recreated",
        uuid: twin.uuid,
        path: change.path,
        name: change.name,
        itemsBefore: before.get(change.uuid)?.items,
        itemsAfter: after.get(twin.uuid)?.items,
      });
    } else {
      out.push(change);
    }
  }
  for (const change of added) {
    if (!pairedAdds.has(change)) out.push(change);
  }

  return out;
}

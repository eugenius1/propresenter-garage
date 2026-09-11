// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import type { RawDoc } from "./decode";
import type { Change, PlaylistChange } from "./diff";
import type { Operation } from "./operations";

/**
 * Turn a diff entry into edits that make one document match the other.
 *
 * The diff already knows what differs; merging is the question of which side
 * wins. Each change becomes operations applied to the *target* document, taking
 * whatever it needs from the source.
 *
 * Item-level differences -- a rename, a relink, a changed transition, a new
 * mirror -- all collapse to one operation: replace the target's entry with the
 * source's. Reconstructing each difference individually would mean rebuilding a
 * protobuf entry from the model, and the model does not capture every field.
 * Taking the whole entry is both simpler and lossless.
 */

/** Which document is being written to. */
export type MergeDirection = "intoBaseline" | "intoCompare";

export interface MergePlan {
  operations: Operation[];
  /** Set when the change cannot be applied, with the reason left untranslated. */
  blocked?: "unsupported" | "destructive";
  /** Playlists this plan would create on the way, for the interface to report. */
  creates?: string[];
}

function childrenOf(node: any): any[] {
  return node.playlists?.playlists ?? node.children ?? [];
}

function walk(node: any, out: any[] = []): any[] {
  out.push(node);
  for (const child of childrenOf(node)) walk(child, out);
  return out;
}

function playlistExists(doc: RawDoc, uuid: string): boolean {
  return walk(doc.root_node).some((n: any) => n.uuid?.string === uuid);
}

/** The node holding `uuid`, or undefined when it is at the top level. */
function parentOf(doc: RawDoc, uuid: string): any {
  return walk(doc.root_node).find((n: any) =>
    childrenOf(n).some((c: any) => c.uuid?.string === uuid)
  );
}

function nodeIn(doc: RawDoc, uuid: string): any {
  return walk(doc.root_node).find((n: any) => n.uuid?.string === uuid);
}

/**
 * Operations needed before an entry can be placed in `playlistUuid`.
 *
 * A playlist absent from the target is recreated with the *same* uuid it has on
 * the source side, so the two documents stay comparable afterwards: generating
 * a fresh one would make the very next diff report the playlist as renamed or
 * replaced. Its parent is recreated first where that is missing too.
 */
function ensurePlaylist(
  target: RawDoc,
  source: RawDoc,
  playlistUuid: string,
  created: Set<string>
): Operation[] {
  if (playlistExists(target, playlistUuid) || created.has(playlistUuid)) return [];

  const operations: Operation[] = [];
  const parent = parentOf(source, playlistUuid);
  const parentUuid: string | undefined = parent?.uuid?.string;

  // The root has no uuid of its own, so an absent parent means top level.
  if (parentUuid) {
    operations.push(...ensurePlaylist(target, source, parentUuid, created));
  }

  const node = nodeIn(source, playlistUuid);
  created.add(playlistUuid);
  operations.push({
    kind: "createPlaylist",
    uuid: playlistUuid,
    name: node?.name ?? "",
    parentUuid: parentUuid && parentUuid !== "" ? parentUuid : undefined,
    // Mirror the source: a group has to be made as a group, or the child it
    // exists to hold cannot go into it.
    holds: node?.playlists ? "playlists" : "items",
  });
  return operations;
}

/** The raw entry for an item, wherever it sits in the tree. */
function findEntry(doc: RawDoc, itemUuid: string): unknown {
  for (const node of walk(doc.root_node)) {
    const found = (node.items?.items ?? []).find((i: any) => i.uuid?.string === itemUuid);
    if (found) return found;
  }
  return undefined;
}

/**
 * Plan the edits for one change.
 *
 * `source` is the document the change is taken from, `target` the one being
 * brought into line with it.
 */
export function planMerge(
  change: Change,
  direction: MergeDirection,
  baselineDoc: RawDoc,
  compareDoc: RawDoc,
  /** Playlists already queued for creation by earlier changes in the batch. */
  created: Set<string> = new Set()
): MergePlan {
  const intoBaseline = direction === "intoBaseline";
  const target = intoBaseline ? baselineDoc : compareDoc;

  // `change.item` is the entry as it stands on the right-hand (compare) side,
  // and `change.before` as it stands on the left. Which of those is the source
  // depends on the direction being merged.
  const wanted = intoBaseline ? change.item : (change.before ?? change.item);
  const existing = intoBaseline ? (change.before ?? change.item) : change.item;
  const sourceDoc = intoBaseline ? compareDoc : baselineDoc;

  const name = wanted.name || wanted.displayFilename;

  switch (change.type) {
    // Present on one side only. Adding it to the other, or taking it away,
    // depending on which way the merge runs.
    case "added":
    case "removed": {
      const presentIn: MergeDirection =
        change.type === "added" ? "intoCompare" : "intoBaseline";
      const alreadyThere = direction === presentIn;

      if (alreadyThere) {
        // The target already has it and the source does not: remove it.
        const item = change.item;
        return {
          operations: [
            {
              kind: "removeItem",
              playlistUuid: item.playlistUuid,
              itemUuid: item.uuid,
              itemName: item.name || item.displayFilename,
            },
          ],
        };
      }

      const item = change.item;
      const entry = findEntry(sourceDoc, item.uuid);
      if (entry === undefined) return { operations: [], blocked: "unsupported" };

      // The playlist it belongs in may not exist on this side yet; make it.
      const setup = ensurePlaylist(target, sourceDoc, item.playlistUuid, created);
      return {
        operations: [
          ...setup,
          { kind: "insertItem", playlistUuid: item.playlistUuid, itemName: name, entry },
        ],
        creates: setup.filter((o) => o.kind === "createPlaylist").map((o) => o.name),
      };
    }

    case "moved": {
      const setup = ensurePlaylist(target, sourceDoc, wanted.playlistUuid, created);
      return {
        creates: setup.filter((o) => o.kind === "createPlaylist").map((o) => o.name),
        operations: [
          ...setup,
          {
            kind: "moveItem",
            itemUuid: existing.uuid,
            itemName: name,
            fromPlaylistUuid: existing.playlistUuid,
            toPlaylistUuid: wanted.playlistUuid,
          },
        ],
      };
    }

    // Everything else is a difference within one entry, so the entry is taken
    // wholesale rather than reconstructed field by field.
    case "renamed":
    case "relinked":
    case "retimed":
    case "restyled": {
      const entry = findEntry(sourceDoc, wanted.uuid);
      if (entry === undefined) return { operations: [], blocked: "unsupported" };
      return {
        operations: [
          {
            kind: "replaceItem",
            playlistUuid: existing.playlistUuid,
            itemUuid: existing.uuid,
            itemName: name,
            entry,
          },
        ],
      };
    }
  }
}

/**
 * Plan the edits for one playlist-level change.
 *
 * A recreation is deliberately refused. Bringing one across means deleting the
 * target's playlist and everything in it, then making a different one -- too
 * destructive to hide behind a checkbox alongside renames.
 */
export function planPlaylistMerge(
  change: PlaylistChange,
  direction: MergeDirection,
  baselineDoc: RawDoc,
  compareDoc: RawDoc,
  created: Set<string> = new Set()
): MergePlan {
  const intoBaseline = direction === "intoBaseline";
  const target = intoBaseline ? baselineDoc : compareDoc;
  const sourceDoc = intoBaseline ? compareDoc : baselineDoc;

  switch (change.type) {
    case "renamed": {
      // `name`/`fromName` are the compare and baseline sides respectively.
      const to = intoBaseline ? change.name : (change.fromName ?? change.name);
      const from = intoBaseline ? (change.fromName ?? change.name) : change.name;
      if (!playlistExists(target, change.uuid)) return { operations: [], blocked: "unsupported" };
      return {
        operations: [
          { kind: "renamePlaylist", playlistUuid: change.uuid, from, to },
        ],
      };
    }

    // Present on one side only: create it here, or take it away, depending on
    // which way the merge runs. Its contents arrive as their own item changes.
    case "added":
    case "removed": {
      const presentIn: MergeDirection =
        change.type === "added" ? "intoCompare" : "intoBaseline";

      if (direction === presentIn) {
        if (!playlistExists(target, change.uuid)) return { operations: [] };
        return {
          operations: [
            { kind: "removePlaylist", playlistUuid: change.uuid, playlistName: change.name },
          ],
        };
      }

      const setup = ensurePlaylist(target, sourceDoc, change.uuid, created);
      return {
        operations: setup,
        creates: setup
          .filter((o) => o.kind === "createPlaylist")
          .map((o) => (o as Extract<Operation, { kind: "createPlaylist" }>).name),
      };
    }

    case "recreated":
      return { operations: [], blocked: "destructive" };
  }
}

/**
 * Plan a set of changes together.
 *
 * Order matters: removals are applied last so that an earlier operation naming
 * an entry still finds it.
 */
export function planMerges(
  changes: Change[],
  direction: MergeDirection,
  baselineDoc: RawDoc,
  compareDoc: RawDoc,
  playlistChanges: PlaylistChange[] = []
): {
  operations: Operation[];
  blocked: Change[];
  blockedPlaylists: PlaylistChange[];
  creates: string[];
} {
  const operations: Operation[] = [];
  const blocked: Change[] = [];
  const blockedPlaylists: PlaylistChange[] = [];

  // Shared across the batch so two changes bound for the same absent playlist
  // queue one creation between them, not one each.
  const created = new Set<string>();
  const plans = changes.map((change) => ({
    change,
    plan: planMerge(change, direction, baselineDoc, compareDoc, created),
  }));

  const playlistPlans = playlistChanges.map((change) => ({
    change,
    plan: planPlaylistMerge(change, direction, baselineDoc, compareDoc, created),
  }));

  for (const { change, plan } of plans) {
    if (plan.blocked) blocked.push(change);
  }
  for (const { change, plan } of playlistPlans) {
    if (plan.blocked) blockedPlaylists.push(change);
  }

  // Creations first so an insert always finds its playlist. Then renames, then
  // item edits. Removals last -- of items, then of whole playlists -- so an
  // earlier operation still finds the entry or playlist it names.
  const rank = (op: Operation) =>
    op.kind === "createPlaylist" ? -2
      : op.kind === "renamePlaylist" ? -1
      : op.kind === "removeItem" ? 1
      : op.kind === "removePlaylist" ? 2
      : 0;

  for (const { plan } of playlistPlans) operations.push(...plan.operations);
  for (const { plan } of plans) operations.push(...plan.operations);
  operations.sort((a, b) => rank(a) - rank(b));

  const creates = operations
    .filter((op) => op.kind === "createPlaylist")
    .map((op) => (op as Extract<Operation, { kind: "createPlaylist" }>).name);

  return { operations, blocked, blockedPlaylists, creates };
}

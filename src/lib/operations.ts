// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { decodeMediaDocument } from "./model";
import { encodeDocument, type RawDoc } from "./decode";

/**
 * Edits to a media-bin document.
 *
 * Applied to the raw protobuf message rather than rebuilt from the normalised
 * model. The model is a lossy projection -- it captures what the interface
 * needs, not every field ProPresenter writes -- so regenerating a document from
 * it would quietly discard everything it does not model. Editing the raw
 * message in place touches only what an operation names, and leaves the rest
 * byte-identical.
 *
 * Operations carry data, never sentences: the interface renders them in the
 * reader's language.
 */

export type Operation =
  | { kind: "removeItem"; playlistUuid: string; itemUuid: string; itemName: string }
  | {
      kind: "moveItem";
      itemUuid: string;
      itemName: string;
      fromPlaylistUuid: string;
      toPlaylistUuid: string;
    }
  | {
      kind: "reorderItem";
      playlistUuid: string;
      itemUuid: string;
      itemName: string;
      /** Position within the playlist after the move, zero-based. */
      toIndex: number;
    }
  | { kind: "renameItem"; itemUuid: string; from: string; to: string }
  | { kind: "renamePlaylist"; playlistUuid: string; from: string; to: string }
  | { kind: "removePlaylist"; playlistUuid: string; playlistName: string };

export class OperationError extends Error {
  readonly operation: Operation;

  constructor(message: string, operation: Operation) {
    super(message);
    this.name = "OperationError";
    this.operation = operation;
  }
}

/** Deep-clone a document by round-tripping it through the wire format. */
function clone(doc: RawDoc): RawDoc {
  return decodeMediaDocument(encodeDocument(doc));
}

function childrenOf(node: any): any[] {
  return node.playlists?.playlists ?? node.children ?? [];
}

function itemsOf(node: any): any[] | undefined {
  return node.items?.items;
}

/** Every playlist node in the tree, root first. */
function walk(node: any, out: any[] = []): any[] {
  out.push(node);
  for (const child of childrenOf(node)) walk(child, out);
  return out;
}

function findPlaylist(doc: RawDoc, uuid: string, op: Operation): any {
  const found = walk(doc.root_node).find((n: any) => n.uuid?.string === uuid);
  if (!found) throw new OperationError(`no playlist with uuid ${uuid}`, op);
  return found;
}

/** The parent holding `uuid`, or undefined when it is the root. */
function findParentOf(doc: RawDoc, uuid: string): any {
  return walk(doc.root_node).find((n: any) =>
    childrenOf(n).some((c: any) => c.uuid?.string === uuid)
  );
}

function takeItem(playlist: any, itemUuid: string, op: Operation): any {
  const items = itemsOf(playlist);
  if (!items) throw new OperationError(`playlist ${playlist.name} holds no items`, op);
  const index = items.findIndex((i: any) => i.uuid?.string === itemUuid);
  if (index < 0) {
    throw new OperationError(`no item ${itemUuid} in playlist ${playlist.name}`, op);
  }
  return items.splice(index, 1)[0];
}

function applyOne(doc: RawDoc, op: Operation): void {
  switch (op.kind) {
    case "removeItem": {
      takeItem(findPlaylist(doc, op.playlistUuid, op), op.itemUuid, op);
      break;
    }

    case "moveItem": {
      const from = findPlaylist(doc, op.fromPlaylistUuid, op);
      const to = findPlaylist(doc, op.toPlaylistUuid, op);
      const target = itemsOf(to);
      if (!target) {
        // A playlist that has never held items has no `items` oneof branch set.
        throw new OperationError(`playlist ${to.name} cannot hold items`, op);
      }
      target.push(takeItem(from, op.itemUuid, op));
      break;
    }

    case "reorderItem": {
      const playlist = findPlaylist(doc, op.playlistUuid, op);
      const items = itemsOf(playlist);
      if (!items) throw new OperationError(`playlist ${playlist.name} holds no items`, op);
      const item = takeItem(playlist, op.itemUuid, op);
      // Clamp rather than throw: the interface computes indices from a list the
      // reader is looking at, and an off-by-one there should not lose an item.
      const at = Math.max(0, Math.min(op.toIndex, items.length));
      items.splice(at, 0, item);
      break;
    }

    case "renameItem": {
      const item = walk(doc.root_node)
        .flatMap((n: any) => itemsOf(n) ?? [])
        .find((i: any) => i.uuid?.string === op.itemUuid);
      if (!item) throw new OperationError(`no item ${op.itemUuid}`, op);
      item.name = op.to;
      // The cue carries its own copy of the label; ProPresenter keeps them in
      // step, so renaming only the item would leave the file inconsistent.
      if (item.cue) item.cue.name = op.to;
      break;
    }

    case "renamePlaylist": {
      findPlaylist(doc, op.playlistUuid, op).name = op.to;
      break;
    }

    case "removePlaylist": {
      const parent = findParentOf(doc, op.playlistUuid);
      if (!parent) throw new OperationError(`no playlist with uuid ${op.playlistUuid}`, op);
      const siblings = childrenOf(parent);
      const index = siblings.findIndex((c: any) => c.uuid?.string === op.playlistUuid);
      siblings.splice(index, 1);
      break;
    }
  }
}

/**
 * Apply operations in order, returning a new document.
 *
 * The input is never modified, so a caller can keep the original around to
 * compare against or to fall back to.
 */
export function applyOperations(doc: RawDoc, operations: Operation[]): RawDoc {
  const edited = clone(doc);
  for (const op of operations) applyOne(edited, op);
  return edited;
}

/** Apply operations and encode the result, ready to hand to the reader. */
export function exportOperations(doc: RawDoc, operations: Operation[]): Uint8Array {
  return encodeDocument(applyOperations(doc, operations));
}

/**
 * A filename for the exported file.
 *
 * ProPresenter's own file has no extension, and writing back over it is how a
 * library gets destroyed. Exports are always a differently-named copy, which
 * the reader moves into place themselves once they are satisfied.
 */
export function exportFilename(original: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `${original || "Media"}-edited-${stamp}`;
}

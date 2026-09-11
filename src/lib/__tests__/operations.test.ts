// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it, it as baseIt } from "vitest";
import { encodeDocument, checkFidelity } from "../decode";
import { buildLibrary, decodeMediaDocument } from "../model";
import { diffLibraries } from "../diff";
import {
  applyOperations,
  exportFilename,
  exportOperations,
  OperationError,
  type Operation,
} from "../operations";
import { SOURCES } from "./fixtures";

describe.each(SOURCES)("operations [$name]", (source) => {
  const it = source.available ? baseIt : baseIt.skip;

  let bytes: Uint8Array;
  beforeAll(() => {
    if (source.available) bytes = source.read();
  });

  const load = () => decodeMediaDocument(bytes);
  const libOf = (doc: ReturnType<typeof load>) => buildLibrary(doc);

  it("leaves the input document untouched", () => {
    const doc = load();
    const before = encodeDocument(doc);
    const item = libOf(doc).items[0];

    applyOperations(doc, [
      {
        kind: "removeItem",
        playlistUuid: item.playlistUuid,
        itemUuid: item.uuid,
        itemName: item.name,
      },
    ]);

    // Callers keep the original to compare against; mutating it would make the
    // diff between before and after meaningless.
    expect(Buffer.compare(Buffer.from(before), Buffer.from(encodeDocument(doc)))).toBe(0);
  });

  it("applying nothing reproduces the file byte for byte", () => {
    // The strongest statement that editing is additive: an empty edit list is
    // not merely harmless, it is invisible.
    const exported = exportOperations(load(), []);
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(exported))).toBe(0);
  });

  it("an exported file is still a valid, lossless media document", () => {
    const doc = load();
    const item = libOf(doc).items[0];
    const exported = exportOperations(doc, [
      { kind: "renameItem", itemUuid: item.uuid, from: item.name, to: "Renamed" },
    ]);

    expect(checkFidelity(exported).fidelity).toBe("identical");
    expect(libOf(decodeMediaDocument(exported)).items.length).toBe(libOf(doc).items.length);
  });

  it("removes exactly one item and nothing else", () => {
    const doc = load();
    const before = libOf(doc);
    const victim = before.items[1];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "removeItem",
          playlistUuid: victim.playlistUuid,
          itemUuid: victim.uuid,
          itemName: victim.name,
        },
      ])
    );

    expect(after.items.length).toBe(before.items.length - 1);

    const diff = diffLibraries(before, after);
    expect(diff.counts.removed).toBe(1);
    expect(Object.values(diff.counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("moves an item so the diff reports a move, not a delete and an add", () => {
    const doc = load();
    const before = libOf(doc);
    const from = before.playlists[0];
    const to = before.playlists.find((p) => p.uuid !== from.uuid)!;
    const item = from.items[0];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "moveItem",
          itemUuid: item.uuid,
          itemName: item.name,
          fromPlaylistUuid: from.uuid,
          toPlaylistUuid: to.uuid,
        },
      ])
    );

    const diff = diffLibraries(before, after);
    expect(diff.counts.moved).toBe(1);
    expect(diff.counts.added).toBe(0);
    expect(diff.counts.removed).toBe(0);
    expect(after.items.length).toBe(before.items.length);
  });

  it("reorders within a playlist without changing membership", () => {
    const doc = load();
    const before = libOf(doc);
    const playlist = before.playlists.find((p) => p.items.length >= 3)!;
    const moving = playlist.items[0];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "reorderItem",
          playlistUuid: playlist.uuid,
          itemUuid: moving.uuid,
          itemName: moving.name,
          toIndex: 2,
        },
      ])
    );

    const reordered = after.playlists.find((p) => p.uuid === playlist.uuid)!;
    expect(reordered.items[2].uuid).toBe(moving.uuid);
    expect(reordered.items.length).toBe(playlist.items.length);

    // Order is not something the diff reports, so membership is the assertion.
    expect(new Set(reordered.items.map((i) => i.uuid))).toEqual(
      new Set(playlist.items.map((i) => i.uuid))
    );
  });

  it("clamps an out-of-range reorder rather than losing the item", () => {
    const doc = load();
    const before = libOf(doc);
    const playlist = before.playlists.find((p) => p.items.length >= 2)!;
    const moving = playlist.items[0];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "reorderItem",
          playlistUuid: playlist.uuid,
          itemUuid: moving.uuid,
          itemName: moving.name,
          toIndex: 9999,
        },
      ])
    );

    const reordered = after.playlists.find((p) => p.uuid === playlist.uuid)!;
    expect(reordered.items.length).toBe(playlist.items.length);
    expect(reordered.items[reordered.items.length - 1].uuid).toBe(moving.uuid);
  });

  it("renames an item and its cue together", () => {
    const doc = load();
    const before = libOf(doc);
    const item = before.items[0];

    const edited = applyOperations(doc, [
      { kind: "renameItem", itemUuid: item.uuid, from: item.name, to: "New Label" },
    ]);
    const after = libOf(edited);

    expect(after.items.find((i) => i.uuid === item.uuid)!.name).toBe("New Label");

    // ProPresenter keeps the cue's label in step with the item's; leaving one
    // behind would make the file internally inconsistent.
    const raw = (edited as any).root_node;
    const cueNames: string[] = [];
    (function collect(node: any) {
      for (const entry of node.items?.items ?? []) {
        if (entry.uuid?.string === item.uuid) cueNames.push(entry.cue?.name);
      }
      for (const child of node.playlists?.playlists ?? node.children ?? []) collect(child);
    })(raw);
    expect(cueNames).toEqual(["New Label"]);

    const diff = diffLibraries(before, after);
    expect(diff.counts.renamed).toBe(1);
  });

  it("renames a playlist without reporting its contents as moved", () => {
    const doc = load();
    const before = libOf(doc);
    const playlist = before.playlists[0];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "renamePlaylist",
          playlistUuid: playlist.uuid,
          from: playlist.name,
          to: "Renamed Playlist",
        },
      ])
    );

    const diff = diffLibraries(before, after);
    expect(diff.counts.moved).toBe(0);
    expect(diff.playlistChanges).toHaveLength(1);
    expect(diff.playlistChanges[0].type).toBe("renamed");
  });

  it("removes a playlist together with everything in it", () => {
    const doc = load();
    const before = libOf(doc);
    const playlist = before.playlists[0];

    const after = libOf(
      applyOperations(doc, [
        {
          kind: "removePlaylist",
          playlistUuid: playlist.uuid,
          playlistName: playlist.name,
        },
      ])
    );

    expect(after.playlists.some((p) => p.uuid === playlist.uuid)).toBe(false);
    expect(after.items.length).toBe(before.items.length - playlist.items.length);
  });

  it("applies a batch in order", () => {
    const doc = load();
    const before = libOf(doc);
    const playlist = before.playlists.find((p) => p.items.length >= 2)!;
    const [first, second] = playlist.items;

    const operations: Operation[] = [
      {
        kind: "removeItem",
        playlistUuid: playlist.uuid,
        itemUuid: first.uuid,
        itemName: first.name,
      },
      { kind: "renameItem", itemUuid: second.uuid, from: second.name, to: "Survivor" },
      {
        kind: "renamePlaylist",
        playlistUuid: playlist.uuid,
        from: playlist.name,
        to: "Tidied",
      },
    ];

    const after = libOf(applyOperations(doc, operations));
    expect(after.items.length).toBe(before.items.length - 1);
    expect(after.items.find((i) => i.uuid === second.uuid)!.name).toBe("Survivor");
    expect(after.playlists.find((p) => p.uuid === playlist.uuid)!.name).toBe("Tidied");
  });

  it("refuses an operation naming something that is not there", () => {
    const doc = load();
    expect(() =>
      applyOperations(doc, [
        {
          kind: "removeItem",
          playlistUuid: "00000000-0000-4000-8000-ffffffffffff",
          itemUuid: "00000000-0000-4000-8000-eeeeeeeeeeee",
          itemName: "ghost",
        },
      ])
    ).toThrow(OperationError);
  });

  it("leaves the document unchanged when an operation in a batch fails", () => {
    // applyOperations works on a clone, so a partially-applied batch is
    // discarded rather than handed back half-done.
    const doc = load();
    const before = encodeDocument(doc);
    const item = libOf(doc).items[0];

    expect(() =>
      applyOperations(doc, [
        { kind: "renameItem", itemUuid: item.uuid, from: item.name, to: "Fine" },
        { kind: "renameItem", itemUuid: "missing", from: "", to: "Broken" },
      ])
    ).toThrow(OperationError);

    expect(Buffer.compare(Buffer.from(before), Buffer.from(encodeDocument(doc)))).toBe(0);
  });
});

describe("export filename", () => {
  it("never reuses the original name", () => {
    // Writing back over ProPresenter's own file is how a library gets lost.
    const name = exportFilename("Media", new Date("2026-09-11T14:35:00Z"));
    expect(name).not.toBe("Media");
    expect(name).toBe("Media-edited-20260911-1435");
  });

  it("copes with an empty original name", () => {
    expect(exportFilename("", new Date("2026-01-02T03:04:00Z"))).toBe("Media-edited-20260102-0304");
  });
});

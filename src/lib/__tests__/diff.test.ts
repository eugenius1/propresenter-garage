// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it as baseIt } from "vitest";
import { encodeDocument } from "../decode";
import { buildLibrary, decodeMediaDocument } from "../model";
import { diffLibraries } from "../diff";
import { auditLibrary } from "../audit";
import { SOURCES } from "./fixtures";

/** Deep-clone a decoded document by round-tripping it through the wire format. */
function clone(bytes: Uint8Array) {
  return decodeMediaDocument(encodeDocument(decodeMediaDocument(bytes)));
}

/** Depth-first walk over raw playlist nodes. */
function rawNodes(raw: any, out: any[] = []): any[] {
  out.push(raw);
  for (const c of raw.playlists?.playlists ?? raw.children ?? []) rawNodes(c, out);
  return out;
}

function playlistsWithItems(doc: any): any[] {
  return rawNodes(doc.root_node).filter((n) => (n.items?.items ?? []).length > 0);
}

describe.each(SOURCES)("diff against a mutated copy [$name]", (source) => {
  const it = source.available ? baseIt : baseIt.skip;
  // Read in beforeAll, not here: a describe body runs even when skipped.
  let bytes: Uint8Array;
  beforeAll(() => {
    if (source.available) bytes = source.read();
  });

  it("reports no changes when nothing changed", () => {
    const a = buildLibrary(decodeMediaDocument(bytes));
    const b = buildLibrary(clone(bytes));
    const result = diffLibraries(a, b);
    expect(result.changes).toEqual([]);
    expect(result.playlistChanges).toEqual([]);
  });

  it("detects a removed item", () => {
    const mutated = clone(bytes);
    const pl = playlistsWithItems(mutated)[0];
    const [dropped] = pl.items.items.splice(0, 1);

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.removed).toBe(1);
    expect(result.counts.added).toBe(0);
    expect(result.changes[0].item.uuid).toBe(dropped.uuid.string);
  });

  it("detects an item moved between playlists as a move, not delete+add", () => {
    const mutated = clone(bytes);
    const [from, to] = playlistsWithItems(mutated);
    const [item] = from.items.items.splice(0, 1);
    to.items.items.push(item);

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.moved).toBe(1);
    expect(result.counts.added).toBe(0);
    expect(result.counts.removed).toBe(0);

    const move = result.changes.find((c) => c.type === "moved")!;
    expect(move.before!.playlistPath).toContain(from.name);
    expect(move.item.playlistPath).toContain(to.name);
    expect(move.fuzzy).toBe(false);
  });

  it("detects a rename", () => {
    const mutated = clone(bytes);
    playlistsWithItems(mutated)[0].items.items[0].name = "Renamed For Test";

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.renamed).toBe(1);
    expect(result.changes[0].detail).toMatchObject({ kind: "rename", to: "Renamed For Test" });
  });

  it("detects a relinked file path", () => {
    const mutated = clone(bytes);
    const item = playlistsWithItems(mutated)[0].items.items[0];
    item.cue.actions.find((a: any) => a.media).media.element.url.local.path =
      "Media/Assets/somewhere-else.mp4";

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.relinked).toBe(1);
    expect(result.changes[0].detail).toMatchObject({
      kind: "relink",
      to: "Media/Assets/somewhere-else.mp4",
    });
  });

  it("detects changed playback settings as retimed", () => {
    const mutated = clone(bytes);
    const item = playlistsWithItems(mutated)
      .flatMap((p) => p.items.items)
      .find((i: any) => i.cue?.actions?.some((a: any) => a.media?.video))!;
    const media = item.cue.actions.find((a: any) => a.media).media;
    media.transition_duration = (media.transition_duration ?? 0) + 2.5;

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.retimed).toBe(1);
    expect(result.changes[0].detail).toMatchObject({
      kind: "playback",
      deltas: [{ key: "transitionDuration" }],
    });
  });

  it("matches a re-added item by path when its UUID changed", () => {
    const mutated = clone(bytes);
    const item = playlistsWithItems(mutated)[0].items.items[0];
    item.uuid.string = "00000000-0000-4000-8000-000000000abc";

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.added).toBe(0);
    expect(result.counts.removed).toBe(0);
    expect(result.changes.every((c) => c.fuzzy)).toBe(true);
  });

  it("ignores absolute-path churn from a moved library", () => {
    const mutated = clone(bytes);
    for (const pl of playlistsWithItems(mutated)) {
      for (const it of pl.items.items) {
        const url = it.cue?.actions?.find((a: any) => a.media)?.media?.element?.url;
        // Media on an external volume has no `local` path, so leave it alone --
        // only the show-relative items are being churned here.
        if (url?.absolute_string && url.local?.path) {
          url.absolute_string = `D:\\NewLocation\\${url.local.path.replace(/\//g, "\\")}`;
        }
      }
    }
    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.changes).toEqual([]);
  });

  it("does not report items as moved when their playlist is merely renamed", () => {
    const mutated = clone(bytes);
    const pl = playlistsWithItems(mutated)[0];
    const itemCount = pl.items.items.length;
    expect(itemCount).toBeGreaterThan(1);
    pl.name = `${pl.name} 2026`;

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    // A playlist rename is one structural change, not `itemCount` moves.
    expect(result.counts.moved).toBe(0);
    expect(result.counts.added).toBe(0);
    expect(result.counts.removed).toBe(0);
    expect(result.playlistChanges).toHaveLength(1);
    expect(result.playlistChanges[0].type).toBe("renamed");
  });

  it("still reports a move when the item changes playlist and that playlist is renamed", () => {
    const mutated = clone(bytes);
    const [from, to] = playlistsWithItems(mutated);
    const [item] = from.items.items.splice(0, 1);
    to.items.items.push(item);
    to.name = `${to.name} renamed`;

    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.moved).toBe(1);
  });

  it("detects a renamed playlist", () => {
    const mutated = clone(bytes);
    playlistsWithItems(mutated)[0].name = "Renamed Playlist";
    const result = diffLibraries(buildLibrary(decodeMediaDocument(bytes)), buildLibrary(mutated));
    expect(result.playlistChanges.some((c) => c.type === "renamed")).toBe(true);
  });
});

describe.each(SOURCES)("audit [$name]", (source) => {
  const it = source.available ? baseIt : baseIt.skip;
  it("separates within-playlist duplicates from cross-playlist ones", () => {
    const audit = auditLibrary(buildLibrary(decodeMediaDocument(source.read())));
    for (const g of audit.withinPlaylistDuplicates) expect(g.repeatedWithin.length).toBeGreaterThan(0);
    for (const g of audit.crossPlaylistDuplicates) expect(g.repeatedWithin).toEqual([]);
    expect(audit.totals.items).toBeGreaterThan(0);
  });
});

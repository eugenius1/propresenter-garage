// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it as baseIt } from "vitest";
import { encodeDocument, messageType } from "../decode";
import { buildLibrary, decodeMediaDocument } from "../model";
import { diffLibraries, type Change } from "../diff";
import { applyOperations } from "../operations";
import { planMerge, planMerges, type MergeDirection } from "../merge";
import { SOURCES } from "./fixtures";

/**
 * Merging is verified by its effect, not its plan: apply the operations, then
 * assert the chosen change has disappeared from the diff while the others
 * remain. That is the property a reader actually cares about.
 */
describe.each(SOURCES)("merge [$name]", (source) => {
  const it = source.available ? baseIt : baseIt.skip;

  let bytes: Uint8Array;
  beforeAll(() => {
    if (source.available) bytes = source.read();
  });

  /** A pair of documents differing in one specific way. */
  function pairWith(mutate: (doc: any) => void) {
    const baselineDoc = decodeMediaDocument(bytes);
    const compareDoc = decodeMediaDocument(bytes);
    mutate(compareDoc);
    return { baselineDoc, compareDoc };
  }

  const rawPlaylists = (doc: any) => {
    const out: any[] = [];
    (function walk(node: any) {
      out.push(node);
      for (const c of node.playlists?.playlists ?? node.children ?? []) walk(c);
    })(doc.root_node);
    return out.filter((n) => (n.items?.items ?? []).length > 0);
  };

  function diffOf(baselineDoc: any, compareDoc: any) {
    return diffLibraries(buildLibrary(baselineDoc), buildLibrary(compareDoc));
  }

  /** Apply a merge and return the diff that remains. */
  function afterMerge(
    baselineDoc: any,
    compareDoc: any,
    changes: Change[],
    direction: MergeDirection
  ) {
    const { operations } = planMerges(changes, direction, baselineDoc, compareDoc);
    if (direction === "intoBaseline") {
      return diffOf(applyOperations(baselineDoc, operations), compareDoc);
    }
    return diffOf(baselineDoc, applyOperations(compareDoc, operations));
  }

  it("brings a rename into the baseline, leaving no difference", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      rawPlaylists(doc)[0].items.items[0].name = "Renamed On The Right";
    });

    const diff = diffOf(baselineDoc, compareDoc);
    expect(diff.counts.renamed).toBe(1);

    const after = afterMerge(baselineDoc, compareDoc, diff.changes, "intoBaseline");
    expect(after.changes).toEqual([]);
  });

  it("can push the baseline's version the other way instead", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      rawPlaylists(doc)[0].items.items[0].name = "Renamed On The Right";
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const after = afterMerge(baselineDoc, compareDoc, diff.changes, "intoCompare");
    expect(after.changes).toEqual([]);

    // Merging the other way keeps the baseline's name, not the compare's.
    const { operations } = planMerges(diff.changes, "intoCompare", baselineDoc, compareDoc);
    const merged = buildLibrary(applyOperations(compareDoc, operations));
    const baseline = buildLibrary(baselineDoc);
    const target = merged.items.find((i) => i.uuid === baseline.items[0].uuid)!;
    expect(target.name).toBe(baseline.items[0].name);
  });

  it("adopts an item that exists only on the other side", () => {
    let removedUuid = "";
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      // Remove from compare, so the baseline has an item the compare lacks.
      const playlist = rawPlaylists(doc)[0];
      removedUuid = playlist.items.items[0].uuid.string;
      playlist.items.items.splice(0, 1);
    });

    const diff = diffOf(baselineDoc, compareDoc);
    expect(diff.counts.removed).toBe(1);

    // Merging into compare should add it back.
    const { operations } = planMerges(diff.changes, "intoCompare", baselineDoc, compareDoc);
    expect(operations[0].kind).toBe("insertItem");

    const merged = buildLibrary(applyOperations(compareDoc, operations));
    expect(merged.items.some((i) => i.uuid === removedUuid)).toBe(true);
    expect(diffOf(baselineDoc, applyOperations(compareDoc, operations)).changes).toEqual([]);
  });

  it("drops an item the other side does not have", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      rawPlaylists(doc)[0].items.items.splice(0, 1);
    });

    const diff = diffOf(baselineDoc, compareDoc);
    // Merging into the baseline means accepting the compare's absence of it.
    const { operations } = planMerges(diff.changes, "intoBaseline", baselineDoc, compareDoc);
    expect(operations[0].kind).toBe("removeItem");
    expect(afterMerge(baselineDoc, compareDoc, diff.changes, "intoBaseline").changes).toEqual([]);
  });

  it("brings a move across", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const [from, to] = rawPlaylists(doc);
      to.items.items.push(from.items.items.splice(0, 1)[0]);
    });

    const diff = diffOf(baselineDoc, compareDoc);
    expect(diff.counts.moved).toBe(1);
    expect(afterMerge(baselineDoc, compareDoc, diff.changes, "intoBaseline").changes).toEqual([]);
  });

  it("brings a relink across, keeping the entry in place", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const item = rawPlaylists(doc)[0].items.items[0];
      const url = item.cue.actions.find((a: any) => a.media).media.element.url;
      if (url.local) url.local.path = "Media/Assets/replacement.mov";
      else url.absolute_string = "D:/replacement.mov";
    });

    const diff = diffOf(baselineDoc, compareDoc);
    expect(diff.counts.relinked).toBe(1);

    const { operations } = planMerges(diff.changes, "intoBaseline", baselineDoc, compareDoc);
    expect(operations[0].kind).toBe("replaceItem");

    const merged = applyOperations(baselineDoc, operations);
    expect(diffOf(merged, compareDoc).changes).toEqual([]);

    // Replacing in place must not reorder the playlist.
    const before = buildLibrary(baselineDoc).playlists[0];
    const after = buildLibrary(merged).playlists.find((p) => p.uuid === before.uuid)!;
    expect(after.items.map((i) => i.uuid)).toEqual(before.items.map((i) => i.uuid));
  });

  it("merges only the changes chosen, leaving the rest alone", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const playlist = rawPlaylists(doc)[0];
      playlist.items.items[0].name = "First Renamed";
      playlist.items.items[1].name = "Second Renamed";
    });

    const diff = diffOf(baselineDoc, compareDoc);
    expect(diff.counts.renamed).toBe(2);

    const after = afterMerge(baselineDoc, compareDoc, [diff.changes[0]], "intoBaseline");
    expect(after.counts.renamed).toBe(1);
  });

  it("does not touch the documents it is given", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      rawPlaylists(doc)[0].items.items[0].name = "Renamed";
    });
    const before = encodeDocument(baselineDoc);

    const diff = diffOf(baselineDoc, compareDoc);
    planMerges(diff.changes, "intoBaseline", baselineDoc, compareDoc);

    expect(Buffer.compare(Buffer.from(before), Buffer.from(encodeDocument(baselineDoc)))).toBe(0);
  });

  it("keeps the target's identity when replacing an entry", () => {
    // Two snapshots of one library can give the same media different uuids, so
    // the diff matches those pairs by path instead. Taking the source entry
    // verbatim would hand the target the source's uuid -- breaking any later
    // operation naming the original, and turning the entry into a different
    // item as far as every future diff is concerned.
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const item = rawPlaylists(doc)[0].items.items[0];
      item.uuid.string = "00000000-0000-4000-8000-ffffffffff99";
      item.name = "Re-added By Hand";
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const renamed = diff.changes.find((c) => c.type === "renamed")!;
    expect(renamed.fuzzy).toBe(true);

    const originalUuid = renamed.before!.uuid;
    const { operations } = planMerges([renamed], "intoBaseline", baselineDoc, compareDoc);
    const merged = buildLibrary(applyOperations(baselineDoc, operations));

    const item = merged.items.find((i) => i.name === "Re-added By Hand")!;
    expect(item.uuid).toBe(originalUuid);
    expect(merged.items.some((i) => i.uuid === "00000000-0000-4000-8000-ffffffffff99")).toBe(false);
  });

  it("applies several changes to one entry together", () => {
    // A rename and a restyle of the same entry produce two changes. Applying
    // the first must leave the second still able to find its target.
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const item = rawPlaylists(doc)[0].items.items[0];
      item.uuid.string = "00000000-0000-4000-8000-ffffffffff98";
      item.name = "Renamed And Restyled";
      const el = item.cue.actions.find((a: any) => a.media).media.element;
      const props = el.image ?? el.video;
      props.drawing ??= {};
      props.drawing.flipped_horizontally = true;
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const chosen = diff.changes.filter((c) => c.type === "renamed" || c.type === "restyled");
    expect(chosen.length).toBe(2);

    expect(() =>
      applyOperations(
        baselineDoc,
        planMerges(chosen, "intoBaseline", baselineDoc, compareDoc).operations
      )
    ).not.toThrow();

    expect(afterMerge(baselineDoc, compareDoc, chosen, "intoBaseline").changes).toEqual([]);
  });

  it("creates the playlist an incoming item needs, keeping its identity", () => {
    // Recreating it with the source's uuid rather than a fresh one is what
    // keeps the two documents comparable: a new uuid would make the very next
    // diff report the playlist as replaced.
    //
    // A wholly new playlist holding a wholly new item: renaming or re-keying an
    // existing playlist would not do, since the diff matches items by their own
    // uuid and would call that a move.
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const template = rawPlaylists(doc)[0];
      const fresh = JSON.parse(JSON.stringify(template.toJSON ? template.toJSON() : template));
      fresh.uuid = { string: "00000000-0000-4000-8000-ffffffffff01" };
      fresh.name = "Brand New Playlist";
      fresh.items.items = fresh.items.items.slice(0, 1);
      fresh.items.items[0].uuid = { string: "00000000-0000-4000-8000-ffffffffff02" };
      doc.root_node.playlists.playlists.push(
        messageType("rv.data.Playlist").fromObject(fresh)
      );
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const added = diff.changes.filter((c) => c.type === "added");
    expect(added.length).toBeGreaterThan(0);

    const plan = planMerge(added[0], "intoBaseline", baselineDoc, compareDoc);
    expect(plan.blocked).toBeUndefined();
    expect(plan.operations[0]).toMatchObject({
      kind: "createPlaylist",
      uuid: "00000000-0000-4000-8000-ffffffffff01",
      name: "Brand New Playlist",
    });
    expect(plan.creates).toEqual(["Brand New Playlist"]);

    const merged = buildLibrary(applyOperations(baselineDoc, plan.operations));
    const created = merged.playlists.find((p) => p.name === "Brand New Playlist")!;
    expect(created.uuid).toBe("00000000-0000-4000-8000-ffffffffff01");
    expect(created.items).toHaveLength(1);
  });

  it("creates a missing playlist once for several incoming items", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const template = rawPlaylists(doc)[0];
      const fresh = JSON.parse(JSON.stringify(template.toJSON ? template.toJSON() : template));
      fresh.uuid = { string: "00000000-0000-4000-8000-ffffffffff11" };
      fresh.name = "Shared New Playlist";
      fresh.items.items = fresh.items.items.slice(0, 2);
      fresh.items.items[0].uuid = { string: "00000000-0000-4000-8000-ffffffffff12" };
      fresh.items.items[1].uuid = { string: "00000000-0000-4000-8000-ffffffffff13" };
      doc.root_node.playlists.playlists.push(messageType("rv.data.Playlist").fromObject(fresh));
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const added = diff.changes.filter((c) => c.type === "added");
    expect(added.length).toBe(2);

    const { operations } = planMerges(added, "intoBaseline", baselineDoc, compareDoc);
    // Two items bound for one absent playlist must queue one creation, not two:
    // the second would fail outright.
    expect(operations.filter((o) => o.kind === "createPlaylist")).toHaveLength(1);
    expect(() => applyOperations(baselineDoc, operations)).not.toThrow();
    expect(afterMerge(baselineDoc, compareDoc, added, "intoBaseline").changes).toEqual([]);
  });

  it("recreates a missing parent group before its child", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const template = rawPlaylists(doc)[0];
      const child = JSON.parse(JSON.stringify(template.toJSON ? template.toJSON() : template));
      child.uuid = { string: "00000000-0000-4000-8000-ffffffffff21" };
      child.name = "Nested";
      child.items.items = child.items.items.slice(0, 1);
      child.items.items[0].uuid = { string: "00000000-0000-4000-8000-ffffffffff22" };
      const group = {
        uuid: { string: "00000000-0000-4000-8000-ffffffffff20" },
        name: "New Group",
        playlists: { playlists: [child] },
      };
      doc.root_node.playlists.playlists.push(messageType("rv.data.Playlist").fromObject(group));
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const added = diff.changes.filter((c) => c.type === "added");
    const { operations } = planMerges(added, "intoBaseline", baselineDoc, compareDoc);

    const creates = operations.filter((o) => o.kind === "createPlaylist");
    expect(creates.map((o: any) => o.name)).toEqual(["New Group", "Nested"]);

    const merged = buildLibrary(applyOperations(baselineDoc, operations));
    expect(merged.playlists.find((p) => p.name === "Nested")!.path).toBe("New Group / Nested");
  });

  it("applies removals last, so earlier operations still find their entries", () => {
    const { baselineDoc, compareDoc } = pairWith((doc) => {
      const playlist = rawPlaylists(doc)[0];
      playlist.items.items[1].name = "Kept But Renamed";
      playlist.items.items.splice(0, 1);
    });

    const diff = diffOf(baselineDoc, compareDoc);
    const { operations } = planMerges(diff.changes, "intoBaseline", baselineDoc, compareDoc);

    const lastRemoval = operations.findLastIndex((o) => o.kind === "removeItem");
    const firstOther = operations.findIndex((o) => o.kind !== "removeItem");
    if (firstOther >= 0 && lastRemoval >= 0) expect(firstOther).toBeLessThan(lastRemoval);

    expect(afterMerge(baselineDoc, compareDoc, diff.changes, "intoBaseline").changes).toEqual([]);
  });
});

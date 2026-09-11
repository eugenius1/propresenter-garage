// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { decodeDocument, encodeDocument } from "../decode";
import { buildLibrary } from "../model";
import { auditLibrary } from "../audit";
import { diffLibraries } from "../diff";
import { hasRealFile, readRealFile } from "./fixtures";

function clone(bytes: Uint8Array) {
  return decodeDocument(encodeDocument(decodeDocument(bytes)));
}

function rawNodes(raw: any, out: any[] = []): any[] {
  out.push(raw);
  for (const c of raw.playlists?.playlists ?? raw.children ?? []) rawNodes(c, out);
  return out;
}

function allItems(doc: any): any[] {
  return rawNodes(doc.root_node).flatMap((n) => n.items?.items ?? []);
}

function drawingOf(rawItem: any): any {
  const el = rawItem.cue?.actions?.find((a: any) => a.media)?.media?.element;
  const props = el?.image ?? el?.video;
  props.drawing ??= {};
  return props.drawing;
}

describe.skipIf(!hasRealFile)("variants versus duplicates", () => {
  const bytes = readRealFile();

  it("treats the same file with different mirroring as separate entries", () => {
    const lib = buildLibrary(decodeDocument(bytes));
    const mirrored = lib.items.filter((i) => i.modifications.flippedHorizontally);
    expect(mirrored.length).toBeGreaterThan(0);

    for (const m of mirrored) {
      const twin = lib.items.find((i) => i.key === m.key && !i.modifications.flippedHorizontally);
      if (!twin) continue;
      // Same source file...
      expect(twin.key).toBe(m.key);
      // ...but not the same entry, so never reported as a duplicate.
      expect(twin.variantKey).not.toBe(m.variantKey);
    }
  });

  it("does not report mirrored or filtered pairs as duplicates", () => {
    const audit = auditLibrary(buildLibrary(decodeDocument(bytes)));
    const duplicates = [...audit.withinPlaylistDuplicates, ...audit.crossPlaylistDuplicates];
    for (const g of duplicates) {
      const fingerprints = new Set(g.items.map((i) => i.modifications.fingerprint));
      expect(fingerprints.size).toBe(1);
    }
  });

  it("surfaces those pairs as variants instead", () => {
    const audit = auditLibrary(buildLibrary(decodeDocument(bytes)));
    expect(audit.variantGroups.length).toBeGreaterThan(0);
    for (const g of audit.variantGroups) {
      expect(g.variants.length).toBeGreaterThan(1);
    }
  });

  it("keeps scale behaviour out of the duplicate identity", () => {
    // Scale behaviour is applied by ProPresenter on import, not chosen. Two
    // otherwise-identical entries must stay duplicates even if it differs.
    const mutated = clone(bytes);
    const items = allItems(mutated);
    const target = items.find((i) => {
      const el = i.cue?.actions?.find((a: any) => a.media)?.media?.element;
      return el?.image || el?.video;
    })!;
    drawingOf(target).scale_behavior = 2;

    const before = buildLibrary(decodeDocument(bytes));
    const after = buildLibrary(mutated);

    const beforeItem = before.items.find((i) => i.uuid === target.uuid.string)!;
    const afterItem = after.items.find((i) => i.uuid === target.uuid.string)!;
    expect(afterItem.variantKey).toBe(beforeItem.variantKey);

    // ...and it must not show up as a change either.
    expect(diffLibraries(before, after).counts.restyled).toBe(0);
  });

  it("reports a new mirror as restyled, not as added and removed", () => {
    const mutated = clone(bytes);
    const target = allItems(mutated).find((i) => {
      const el = i.cue?.actions?.find((a: any) => a.media)?.media?.element;
      return el?.image || el?.video;
    })!;
    drawingOf(target).flipped_horizontally = true;

    const result = diffLibraries(
      buildLibrary(decodeDocument(bytes)),
      buildLibrary(mutated)
    );
    expect(result.counts.restyled).toBe(1);
    expect(result.counts.added).toBe(0);
    expect(result.counts.removed).toBe(0);
    expect(result.changes.find((c) => c.type === "restyled")!.detail).toMatchObject({
      kind: "mods",
      from: [],
      to: [{ kind: "mirroredHorizontally" }],
    });
  });

  it("reports a changed colour filter as restyled", () => {
    const mutated = clone(bytes);
    const lib = buildLibrary(mutated);
    const withEffect = lib.items.find((i) => i.modifications.effects.length > 0);
    expect(withEffect).toBeDefined();

    const target = allItems(mutated).find((i) => i.uuid?.string === withEffect!.uuid)!;
    const drawing = drawingOf(target);
    const effects = drawing.effects?.length ? drawing.effects : target.cue.actions.find((a: any) => a.media).media.effects;
    effects[0].enabled = false;

    const result = diffLibraries(buildLibrary(decodeDocument(bytes)), buildLibrary(mutated));
    expect(result.counts.restyled).toBe(1);
    const detail = result.changes.find((c) => c.type === "restyled")!.detail;
    expect(detail.kind).toBe("mods");
    if (detail.kind !== "mods") throw new Error("expected a mods detail");
    // The effect is still listed, now marked disabled.
    expect(detail.to.some((d) => d.kind === "effect" && !d.enabled)).toBe(true);
  });
});

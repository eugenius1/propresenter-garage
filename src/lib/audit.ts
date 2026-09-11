// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { basename, type MediaItem, type MediaLibrary, type ModDescriptor } from "./model";

/**
 * Findings derivable from a single media-bin snapshot.
 *
 * Duplicate detection turns on one distinction. Several entries can point at
 * the same source file and still be different content, because ProPresenter
 * stores mirroring, cropping and effects per entry -- the same photo flipped,
 * or the same map recoloured. Those are deliberate variants. Only entries
 * sharing a file *and* an identical set of visual modifications are genuinely
 * redundant, and only those are reported as duplicates.
 */

export interface DuplicateGroup {
  variantKey: string;
  filename: string;
  items: MediaItem[];
  labels: string[];
  /** Playlists in which this exact entry appears more than once. */
  repeatedWithin: string[];
  playlists: string[];
  /** Set when the copies differ only in scale/alignment, which is a weak signal. */
  layoutDiffers: boolean;
}

export interface VariantGroup {
  filename: string;
  /** The shared source file as stored, so it can be found on disk. */
  path: string;
  /** One entry per distinct set of visual modifications. */
  variants: {
    labels: string[];
    modifications: ModDescriptor[];
    count: number;
    /** Where this particular variant lives, so it can be found in the bin. */
    playlists: string[];
  }[];
  totalItems: number;
}

export interface AuditResult {
  totals: {
    items: number;
    playlists: number;
    emptyPlaylists: number;
    video: number;
    image: number;
    audio: number;
    other: number;
    modified: number;
  };
  /** Same file, same modifications, appearing twice in one playlist. */
  withinPlaylistDuplicates: DuplicateGroup[];
  /** Same file, same modifications, spread across playlists. */
  crossPlaylistDuplicates: DuplicateGroup[];
  /** Same file, different modifications -- deliberate variants, not problems. */
  variantGroups: VariantGroup[];
  emptyPlaylists: string[];
  externalVolumeItems: MediaItem[];
  absolutePathRoots: { root: string; count: number }[];
  hiddenItems: MediaItem[];
  nameMismatches: { item: MediaItem; filename: string }[];
}

/** Longest common directory prefix of the stored absolute paths. */
function absoluteRoot(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts.slice(0, Math.max(1, parts.length - 2)).join("/");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "");
}

function groupBy<T>(rows: T[], pick: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = pick(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function auditLibrary(lib: MediaLibrary): AuditResult {
  const withinPlaylistDuplicates: DuplicateGroup[] = [];
  const crossPlaylistDuplicates: DuplicateGroup[] = [];

  // Redundancy: identical file *and* identical visual modifications.
  for (const [variantKey, items] of groupBy(lib.items, (i) => i.variantKey)) {
    if (items.length < 2) continue;

    const perPlaylist = groupBy(items, (i) => i.playlistPath);
    const repeatedWithin = [...perPlaylist]
      .filter(([, rows]) => rows.length > 1)
      .map(([path]) => path);

    const group: DuplicateGroup = {
      variantKey,
      filename: items[0].displayFilename,
      items,
      labels: unique(items.map((i) => i.name)),
      repeatedWithin,
      playlists: [...perPlaylist.keys()],
      layoutDiffers:
        unique(items.map((i) => JSON.stringify(i.modifications.layout))).length > 1,
    };

    if (repeatedWithin.length) withinPlaylistDuplicates.push(group);
    else crossPlaylistDuplicates.push(group);
  }

  const byCount = (a: DuplicateGroup, b: DuplicateGroup) => b.items.length - a.items.length;
  withinPlaylistDuplicates.sort(byCount);
  crossPlaylistDuplicates.sort(byCount);

  // Deliberate variants: one file, several distinct modification sets.
  const variantGroups: VariantGroup[] = [];
  for (const [, items] of groupBy(lib.items, (i) => i.key)) {
    const byVariant = groupBy(items, (i) => i.modifications.fingerprint);
    if (byVariant.size < 2) continue;

    variantGroups.push({
      filename: items[0].displayFilename,
      path: items[0].relativePath || items[0].absolutePath,
      totalItems: items.length,
      variants: [...byVariant.values()]
        .map((rows) => ({
          labels: unique(rows.map((r) => r.name)),
          modifications: rows[0].modifications.descriptors,
          count: rows.length,
          playlists: unique(rows.map((r) => r.playlistPath)),
        }))
        // Show the untouched original first, then the edits.
        .sort((a, b) => a.modifications.length - b.modifications.length),
    });
  }
  variantGroups.sort((a, b) => b.variants.length - a.variants.length);

  const emptyPlaylists: string[] = [];
  (function walk(n: MediaLibrary["root"]) {
    if (n.kind !== "root" && n.items.length === 0 && n.children.length === 0) {
      emptyPlaylists.push(n.path);
    }
    n.children.forEach(walk);
  })(lib.root);

  const rootCounts = new Map<string, number>();
  for (const i of lib.items) {
    if (!i.absolutePath) continue;
    const r = absoluteRoot(i.absolutePath);
    rootCounts.set(r, (rootCounts.get(r) ?? 0) + 1);
  }

  const nameMismatches = lib.items
    .filter((i) => {
      if (!i.name || !i.relativePath) return false;
      // An entry that has been modified is *expected* to carry its own label,
      // so those are not mismatches worth reporting.
      if (i.modifications.descriptors.length > 0) return false;
      const file = norm(i.displayFilename);
      const label = norm(i.name);
      return Boolean(file) && Boolean(label) && !file.includes(label) && !label.includes(file);
    })
    .map((i) => ({ item: i, filename: basename(i.relativePath) }));

  return {
    totals: {
      items: lib.items.length,
      playlists: lib.playlists.length,
      emptyPlaylists: emptyPlaylists.length,
      video: lib.items.filter((i) => i.kind === "video").length,
      image: lib.items.filter((i) => i.kind === "image").length,
      audio: lib.items.filter((i) => i.kind === "audio").length,
      other: lib.items.filter((i) => !["video", "image", "audio"].includes(i.kind)).length,
      modified: lib.items.filter((i) => i.modifications.descriptors.length > 0).length,
    },
    withinPlaylistDuplicates,
    crossPlaylistDuplicates,
    variantGroups,
    emptyPlaylists,
    externalVolumeItems: lib.items.filter((i) => i.root.startsWith("EXTERNAL")),
    absolutePathRoots: [...rootCounts]
      .map(([root, count]) => ({ root, count }))
      .sort((a, b) => b.count - a.count),
    hiddenItems: lib.items.filter((i) => i.hidden),
    nameMismatches,
  };
}

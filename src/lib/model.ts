// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { decodeDocument, enumLabel, type RawDoc } from "./decode";

/**
 * A normalised view of a media-bin playlist document.
 *
 * The raw protobuf is awkward to work with directly: nodes carry a `type` field
 * ProPresenter never actually writes, children hide behind a oneof, and each
 * item's media path exists in three redundant forms. This module flattens all
 * of that into something the diff and audit can reason about.
 */

export type NodeKind = "root" | "group" | "playlist";

export interface MediaItem {
  uuid: string;
  name: string;
  /** Canonical comparison key: ROOT-relative path, separators and case normalised. */
  key: string;
  /** Relative path as stored, e.g. "Media/Assets/Fond uni orange.mov". */
  relativePath: string;
  /** Root the relative path hangs off, e.g. "ROOT_SHOW". */
  root: string;
  /** Absolute path as stored. Unreliable for comparison -- see `key`. */
  absolutePath: string;
  /** Filename only, with ProPresenter's import UUID prefix stripped. */
  displayFilename: string;
  kind: "video" | "image" | "audio" | "live_video" | "other";
  /** Path of the playlist holding this item, e.g. "Fonds / Nature / Ciel". */
  playlistPath: string;
  playlistUuid: string;
  /** Zero-based position within its playlist. */
  index: number;
  hidden: boolean;
  /** Playback settings, so the diff can report "same file, retimed". */
  playback: PlaybackSettings;
  /** Mirroring, rotation, crop, blur and effects applied to the source file. */
  modifications: Modifications;
  /**
   * Identity for duplicate detection: the media path *plus* the modifications.
   * Two entries sharing a `key` but not a `variantKey` are deliberate variants
   * of one file, not duplicates.
   */
  variantKey: string;
}

/**
 * A single modification, described structurally rather than as text.
 *
 * These feed both the duplicate fingerprint and the UI. Keeping them
 * structural is what lets the interface be translated without changing what
 * counts as a duplicate -- an earlier version built the fingerprint out of
 * English display strings, which would have made duplicate detection depend
 * on the chosen language.
 */
export type ModDescriptor =
  | { kind: "mirroredHorizontally" }
  | { kind: "mirroredVertically" }
  | { kind: "rotated"; degrees: number }
  | { kind: "blurred" }
  | { kind: "alphaInverted" }
  | { kind: "cropped" }
  | { kind: "effect"; name: string; enabled: boolean; values: string[] };

/** Scale and alignment, kept apart from the modification identity. */
export type LayoutDescriptor = { kind: "scale" | "align"; value: string };

export interface EffectSummary {
  name: string;
  enabled: boolean;
  /** Non-default variable values, so two presets tuned differently compare unequal. */
  values: string[];
}

/**
 * Everything ProPresenter can do to a media file without changing which file
 * it is: mirroring, rotation, cropping, blur, alpha inversion and effects
 * (colour filters and the like).
 *
 * This matters for duplicate detection. Two entries can legitimately point at
 * one source file and still be different content -- the same photo mirrored, or
 * the same map recoloured. Comparing the file path alone would call those
 * duplicates; comparing path *and* modifications tells them apart.
 */
export interface Modifications {
  flippedHorizontally: boolean;
  flippedVertically: boolean;
  nativeRotation?: number;
  customRotation?: number;
  blurred: boolean;
  alphaInverted: boolean;
  cropped: boolean;
  scaleBehavior?: string;
  scaleAlignment?: string;
  effects: EffectSummary[];
  /** The visual modifications, ready to be rendered in any language. */
  descriptors: ModDescriptor[];
  /**
   * Identity of the *visual* modifications -- mirroring, rotation, blur, alpha,
   * crop and effects. Derived from `descriptors`, so it is independent of the
   * interface language.
   *
   * Deliberately excludes scale behaviour and alignment. Those are set by
   * ProPresenter on import rather than chosen by a person: in one real library
   * 331 of 482 items carried `BEHAVIOR_FILL` and the remaining 144 carried
   * nothing at all, tracking when each item was added rather than any decision
   * about it. Folding that into the identity would split genuine duplicates
   * apart into false "variants".
   */
  fingerprint: string;
  /** Scale and alignment. See `fingerprint` for why these are separate. */
  layout: LayoutDescriptor[];
}

export interface PlaybackSettings {
  transitionDuration?: number;
  playbackBehavior?: string;
  endBehavior?: string;
  timesToLoop?: number;
  loopTime?: number;
  softLoop?: boolean;
  markerCount: number;
  effectCount: number;
}

export interface PlaylistNode {
  uuid: string;
  name: string;
  kind: NodeKind;
  /** " / "-joined ancestry including this node's own name. */
  path: string;
  children: PlaylistNode[];
  items: MediaItem[];
}

export interface MediaLibrary {
  root: PlaylistNode;
  /** Every item in the tree, in document order. */
  items: MediaItem[];
  /** Every playlist node that holds items, in document order. */
  playlists: PlaylistNode[];
  appVersion: string;
  platform: string;
}

/** ProPresenter's importer prefixes copied files with a bare 36-char UUID. */
const IMPORT_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function stripImportPrefix(filename: string): string {
  return filename.replace(IMPORT_PREFIX, "");
}

/**
 * Build the comparison key for an item.
 *
 * Deliberately built from the ROOT-relative path, never the absolute one. Real
 * libraries accumulate inconsistent absolute paths as they move between
 * machines and folders -- one observed library held both
 * `C:\Users\video\AppData\Roaming\...\Media\Assets\x.mp4` and
 * `C:\Users\Video\Documents\ProPresenter\Media\Assets\y.mov`. Keying on those
 * would report an entire library as changed after a single move.
 */
function comparisonKey(root: string, relativePath: string): string {
  return `${root}::${relativePath.replace(/\\/g, "/").toLowerCase()}`;
}

function mediaKind(media: any): MediaItem["kind"] {
  if (media?.image) return "image";
  if (media?.video) return "video";
  if (media?.audio) return "audio";
  if (media?.live_video) return "live_video";
  return "other";
}

const PLAYBACK_BEHAVIOR = ["STOP", "LOOP", "LOOP_FOR_COUNT", "LOOP_FOR_TIME"];
const END_BEHAVIOR = ["STOP", "STOP_ON_BLACK", "STOP_ON_CLEAR", "FADE_TO_BLACK", "FADE_TO_CLEAR"];

function enumName(table: string[], v: unknown): string | undefined {
  if (typeof v === "number") return table[v] ?? String(v);
  return typeof v === "string" ? v : undefined;
}

function playbackSettings(media: any): PlaybackSettings {
  const typed = media?.video ?? media?.audio ?? {};
  return {
    transitionDuration: media?.transition_duration,
    playbackBehavior: enumName(PLAYBACK_BEHAVIOR, typed.playback_behavior),
    endBehavior: enumName(END_BEHAVIOR, typed.end_behavior),
    timesToLoop: typed.times_to_loop,
    loopTime: typed.loop_time,
    softLoop: typed.soft_loop,
    markerCount: media?.markers?.length ?? 0,
    effectCount: media?.effects?.length ?? 0,
  };
}

const SCALE_BEHAVIOR = "rv.data.Media.ScaleBehavior";
const SCALE_ALIGNMENT = "rv.data.Media.ScaleAlignment";

function effectSummaries(list: any[] | undefined): EffectSummary[] {
  return (list ?? []).map((e: any) => ({
    name: e.name || e.render_id || "effect",
    enabled: e.enabled !== false,
    values: (e.variables ?? [])
      .map((v: any) => {
        const typed = v.int ?? v.float ?? v.double ?? v.color ?? v.direction ?? v.bool ?? v.slider;
        if (!typed) return "";
        if (typed.color) return `${v.name ?? ""}=${formatColor(typed.color)}`;
        const value = typed.value;
        const dflt = typed.default_value;
        // Only record variables actually moved off their default -- otherwise
        // every effect of the same kind would fingerprint identically.
        if (value === undefined || value === dflt) return "";
        // Round to 3dp: these arrive as float32, so the raw values carry
        // artefacts like 0.20000000298023224 that are noise, not signal.
        return `${v.name ?? ""}=${typeof value === "number" ? round3(value) : value}`;
      })
      .filter(Boolean)
      .sort(),
  }));
}

/** Pull the drawing properties, which hang off whichever type oneof is set. */
function drawingOf(element: any): any {
  return element?.image?.drawing ?? element?.video?.drawing ?? undefined;
}

function extractModifications(media: any, element: any): Modifications {
  const d = drawingOf(element) ?? {};

  // Effects live in two places: on the drawing properties and on the media
  // action itself. Both change what the audience sees, so both count.
  const effects = [...effectSummaries(d.effects), ...effectSummaries(media?.effects)];

  const nativeRotation = d.native_rotation || undefined;
  const customRotation = d.custom_image_rotation || undefined;

  const mods = {
    flippedHorizontally: Boolean(d.flipped_horizontally),
    flippedVertically: Boolean(d.flipped_vertically),
    nativeRotation: typeof nativeRotation === "number" ? nativeRotation : undefined,
    customRotation: typeof customRotation === "number" ? round(customRotation) : undefined,
    blurred: Boolean(d.is_blurred),
    alphaInverted: Boolean(d.alpha_inverted),
    cropped: Boolean(d.crop_enable),
    scaleBehavior: d.scale_behavior ? enumLabel(SCALE_BEHAVIOR, d.scale_behavior) : undefined,
    scaleAlignment: d.scale_alignment ? enumLabel(SCALE_ALIGNMENT, d.scale_alignment) : undefined,
    effects,
  };

  const descriptors: ModDescriptor[] = [];
  if (mods.flippedHorizontally) descriptors.push({ kind: "mirroredHorizontally" });
  if (mods.flippedVertically) descriptors.push({ kind: "mirroredVertically" });
  if (mods.nativeRotation) descriptors.push({ kind: "rotated", degrees: mods.nativeRotation });
  if (mods.customRotation) descriptors.push({ kind: "rotated", degrees: mods.customRotation });
  if (mods.blurred) descriptors.push({ kind: "blurred" });
  if (mods.alphaInverted) descriptors.push({ kind: "alphaInverted" });
  if (mods.cropped) descriptors.push({ kind: "cropped" });
  for (const e of effects) {
    descriptors.push({ kind: "effect", name: e.name, enabled: e.enabled, values: e.values });
  }

  const layout: LayoutDescriptor[] = [];
  if (mods.scaleBehavior) layout.push({ kind: "scale", value: mods.scaleBehavior });
  if (mods.scaleAlignment) layout.push({ kind: "align", value: mods.scaleAlignment });

  // Crop insets belong in the fingerprint but not the displayed description --
  // exact pixel values would make it unreadable while still needing to compare
  // unequal.
  const cropInsets = mods.cropped ? JSON.stringify(d.crop_insets ?? {}) : "";

  return {
    ...mods,
    descriptors,
    layout,
    fingerprint: JSON.stringify([descriptors, cropInsets]),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Compact rgb(a) rendering, so a colour swap reads at a glance. */
function formatColor(c: any): string {
  const ch = (v: unknown) => Math.round((typeof v === "number" ? v : 0) * 255);
  const alpha = c.alpha ?? 1;
  const rgb = `${ch(c.red)},${ch(c.green)},${ch(c.blue)}`;
  return alpha === 1 ? `rgb(${rgb})` : `rgba(${rgb},${round3(alpha)})`;
}

/**
 * Classify a node.
 *
 * `Playlist.type` is never populated in media documents -- every node decodes
 * as TYPE_UNKNOWN -- so the shape of the oneof is the only reliable signal.
 */
function classify(raw: any, isRoot: boolean): NodeKind {
  if (isRoot) return "root";
  return raw.playlists ? "group" : "playlist";
}

function rawChildren(raw: any): any[] {
  return raw.playlists?.playlists ?? raw.children ?? [];
}

function rawItems(raw: any): any[] {
  return raw.items?.items ?? [];
}

/** Label an external volume so media on a different drive never key-matches local media. */
function externalRootLabel(external: any): string {
  const volume = external.macos?.volume_name ?? external.win32?.volume_name ?? external.win32?.drive_letter;
  return volume ? `EXTERNAL:${String(volume).toLowerCase()}` : "EXTERNAL";
}

/**
 * Decode a media-bin document, rejecting any other playlist kind.
 *
 * The kind lives here rather than at each call site: `decodeDocument` is shared
 * by every tool, and this is the Media Bin's own entry point into it.
 */
export function decodeMediaDocument(bytes: Uint8Array): RawDoc {
  return decodeDocument(bytes, "media");
}

export function buildLibrary(doc: RawDoc): MediaLibrary {
  const items: MediaItem[] = [];
  const playlists: PlaylistNode[] = [];

  function visit(raw: any, ancestry: string[], isRoot: boolean): PlaylistNode {
    const name: string = raw.name ?? "";
    const path = isRoot ? "" : [...ancestry, name].join(" / ");
    const uuid: string = raw.uuid?.string ?? "";

    const node: PlaylistNode = {
      uuid,
      name,
      kind: classify(raw, isRoot),
      path,
      children: [],
      items: [],
    };

    rawItems(raw).forEach((rawItem: any, index: number) => {
      const media = rawItem.cue?.actions?.find((a: any) => a.media)?.media;
      const element = media?.element;
      const url = element?.url;

      const relativePath: string = url?.local?.path ?? url?.external?.path ?? url?.relative_path ?? "";
      const root: string = url?.local
        ? String(url.local.root ?? "ROOT_UNKNOWN")
        : url?.external
          ? externalRootLabel(url.external)
          : "";
      const absolutePath: string = url?.absolute_string ?? "";
      // Fall back to the absolute path so an item with only an absolute form
      // still gets a stable key rather than silently colliding with others.
      const pathForKey = relativePath || absolutePath.replace(/\\/g, "/");

      const item: MediaItem = {
        uuid: rawItem.uuid?.string ?? "",
        name: rawItem.name ?? "",
        key: comparisonKey(root, pathForKey),
        relativePath,
        root,
        absolutePath,
        displayFilename: stripImportPrefix(basename(pathForKey)),
        kind: mediaKind(media),
        playlistPath: path,
        playlistUuid: uuid,
        index,
        hidden: Boolean(rawItem.is_hidden),
        playback: playbackSettings(media),
        modifications: extractModifications(media, element),
        variantKey: "",
      };
      item.variantKey = `${item.key}##${item.modifications.fingerprint}`;

      node.items.push(item);
      items.push(item);
    });

    if (node.items.length > 0) playlists.push(node);

    for (const child of rawChildren(raw)) {
      node.children.push(visit(child, isRoot ? [] : [...ancestry, name], false));
    }

    return node;
  }

  const root = visit(doc.root_node, [], true);
  const info = doc.application_info ?? {};
  const v = info.application_version ?? {};

  return {
    root,
    items,
    playlists,
    appVersion: [v.major_version, v.minor_version, v.patch_version]
      .filter((n: unknown) => n !== undefined)
      .join("."),
    platform: enumLabel("rv.data.ApplicationInfo.Platform", info.platform),
  };
}

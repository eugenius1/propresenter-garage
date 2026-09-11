// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import protobuf from "protobufjs";
import descriptor from "../../generated/pp.descriptor.json";

/**
 * A synthetic media-bin document, built rather than committed.
 *
 * Real ProPresenter files cannot be committed -- they are somebody's actual
 * media library -- so without this the suites that matter most only ran on a
 * machine that happened to have one, and skipped in CI. Generating the fixture
 * keeps it auditable (it is this file, not a binary blob) and guarantees it
 * contains nobody's data.
 *
 * It is deliberately shaped to contain one of everything the analysis cares
 * about, so the same assertions hold against it and against a real library:
 *
 * - nested groups, leaf playlists, and one empty playlist
 * - image and video items, with playback settings on a video
 * - a file appearing twice in one playlist with identical modifications
 *   (a true duplicate) and another spanning two playlists
 * - two files that each back several entries with *different* modifications
 *   (mirroring, and a colour effect) -- variants, not duplicates
 * - absolute paths under two different roots, as libraries accumulate when
 *   they move between machines
 * - one item on an external volume, one hidden item, and one filename still
 *   carrying ProPresenter's import UUID prefix
 */

const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
const PlaylistDocument = root.lookupType("rv.data.PlaylistDocument");

/** Deterministic UUIDs, so a failure names the same item every run. */
function uuid(seed: number): { string: string } {
  const hex = seed.toString(16).padStart(12, "0");
  return { string: `00000000-0000-4000-8000-${hex}` };
}

const WINDOWS_DOCUMENTS = "C:\\Users\\Video\\Documents\\ProPresenter\\Media";
const WINDOWS_APPDATA =
  "C:\\Users\\video\\AppData\\Roaming\\RenewedVision\\ProPresenter\\LocalWorkspaces\\ProPresenter\\Media";

interface ItemSpec {
  id: number;
  name: string;
  /** Path relative to the show folder, e.g. "Media/Assets/rose.jpg". */
  file: string;
  kind: "image" | "video";
  /** Which absolute root this item records. Libraries drift between these. */
  absoluteRoot?: string;
  hidden?: boolean;
  mirrored?: boolean;
  /** A colour effect, which makes this entry a variant of the same file. */
  colourEffect?: { name: string; brightness: number };
  /** Present for a video whose playback has been tuned away from defaults. */
  playback?: { transition: number; loop: boolean };
  /** An item resolved against a named drive rather than the show folder. */
  externalVolume?: string;
}

function url(spec: ItemSpec) {
  if (spec.externalVolume) {
    return {
      platform: "PLATFORM_WIN32",
      absolute_string: `E:\\${spec.file.replace(/\//g, "\\")}`,
      external: {
        win32: { drive_letter: "E", volume_name: spec.externalVolume },
        path: spec.file,
      },
    };
  }
  const base = spec.absoluteRoot ?? WINDOWS_DOCUMENTS;
  return {
    platform: "PLATFORM_WIN32",
    // Both forms are always present in real files, and they disagree about
    // where the library lives once it has moved. The analysis keys on the
    // relative form for exactly that reason.
    absolute_string: `${base}\\${spec.file.replace(/^Media\//, "").replace(/\//g, "\\")}`,
    local: { root: "ROOT_SHOW", path: spec.file },
  };
}

function drawing(spec: ItemSpec) {
  const effects = spec.colourEffect
    ? [
        {
          uuid: uuid(9000 + spec.id),
          enabled: true,
          name: spec.colourEffect.name,
          render_id: "colour",
          variables: [
            {
              name: "Brightness",
              float: { value: spec.colourEffect.brightness, default_value: 0 },
            },
          ],
        },
      ]
    : [];

  return {
    // Set on import rather than chosen, so it must not affect duplicate
    // identity -- every item carries it, including ones that differ elsewhere.
    scale_behavior: "BEHAVIOR_FILL",
    flipped_horizontally: spec.mirrored ?? false,
    effects,
  };
}

function element(spec: ItemSpec) {
  const shared = { uuid: uuid(8000 + spec.id), url: url(spec) };
  return spec.kind === "image"
    ? { ...shared, image: { drawing: drawing(spec) } }
    : { ...shared, video: { drawing: drawing(spec) } };
}

function mediaAction(spec: ItemSpec) {
  const media: Record<string, unknown> = {
    element: element(spec),
    layer_type: "LAYER_TYPE_BACKGROUND",
  };

  if (spec.kind === "image") {
    media.image = {};
  } else {
    media.video = spec.playback
      ? {
          playback_behavior: spec.playback.loop ? "PLAYBACK_BEHAVIOR_LOOP" : "PLAYBACK_BEHAVIOR_STOP",
          end_behavior: "END_BEHAVIOR_FADE_TO_BLACK",
        }
      : {};
  }

  if (spec.playback) media.transition_duration = spec.playback.transition;

  return { uuid: uuid(7000 + spec.id), media };
}

function item(spec: ItemSpec) {
  return {
    uuid: uuid(spec.id),
    name: spec.name,
    is_hidden: spec.hidden ?? false,
    cue: {
      uuid: uuid(6000 + spec.id),
      name: spec.name,
      isEnabled: true,
      actions: [mediaAction(spec)],
    },
  };
}

function playlist(id: number, name: string, specs: ItemSpec[]) {
  return {
    uuid: uuid(1000 + id),
    name,
    items: { items: specs.map(item) },
  };
}

function group(id: number, name: string, children: unknown[]) {
  return {
    uuid: uuid(2000 + id),
    name,
    playlists: { playlists: children },
  };
}

const ROSE = "Media/Assets/rose-gradient.jpg";
const HEARTS = "Media/Assets/hearts.jpg";
const BLUE_LOOP = "Media/Assets/blue-loop.mp4";

const GRADIENTS = playlist(1, "Gradients", [
  { id: 1, name: "Rose Gradient", file: ROSE, kind: "image" },
  // Byte-for-byte the same entry as above, in the same playlist: a genuine
  // duplicate, and the one finding most likely to be an actual mistake.
  { id: 2, name: "Rose Gradient", file: ROSE, kind: "image" },
  // Same file, recoloured. Different content despite the shared source.
  {
    id: 3,
    name: "Orange Gradient",
    file: ROSE,
    kind: "image",
    colourEffect: { name: "Adjust Color", brightness: 0.42 },
  },
  { id: 4, name: "Hearts Right", file: HEARTS, kind: "image" },
]);

const MOTION = playlist(2, "Motion", [
  {
    id: 5,
    name: "Blue Loop",
    file: BLUE_LOOP,
    kind: "video",
    playback: { transition: 0.5, loop: true },
  },
  // Same photograph as "Hearts Right", flipped. The pair a path-only
  // comparison would wrongly call a duplicate.
  { id: 6, name: "Hearts Left", file: HEARTS, kind: "image", mirrored: true },
  { id: 7, name: "Sunrise", file: "Media/Assets/sunrise.mp4", kind: "video" },
]);

const SEASONAL = playlist(3, "Seasonal", []);

const ANNOUNCEMENTS = playlist(4, "Announcements", [
  {
    id: 8,
    name: "Welcome",
    // ProPresenter's importer prefixes copied files with a bare UUID.
    file: "Media/Assets/3a80d6e7-b669-4c5d-9b13-f7f079daf4f3welcome.png",
    kind: "image",
  },
  { id: 9, name: "Notices", file: "Media/Assets/notices.jpg", kind: "image", hidden: true },
  {
    id: 10,
    name: "Roadshow",
    file: "Media/roadshow.mp4",
    kind: "video",
    externalVolume: "ROADSHOW",
  },
]);

const LOGOS = playlist(5, "Logos", [
  { id: 11, name: "Logo Dark", file: "Media/Assets/logo-dark.png", kind: "image" },
  {
    id: 12,
    name: "Logo Light",
    file: "Media/Assets/logo-light.png",
    kind: "image",
    absoluteRoot: WINDOWS_APPDATA,
  },
  // The same entry as in Motion: shared across playlists, which is normally
  // deliberate categorisation rather than a mistake.
  { id: 13, name: "Blue Loop", file: BLUE_LOOP, kind: "video" },
]);

const DOCUMENT = {
  application_info: {
    platform: "PLATFORM_WINDOWS",
    application: "APPLICATION_PROPRESENTER",
    application_version: { major_version: 21, minor_version: 4, patch_version: 2, build: "synthetic" },
  },
  type: "TYPE_MEDIA",
  root_node: {
    uuid: uuid(3000),
    name: "",
    playlists: {
      playlists: [
        group(1, "Backgrounds", [GRADIENTS, MOTION, SEASONAL]),
        ANNOUNCEMENTS,
        LOGOS,
      ],
    },
  },
  // Real files carry this alongside root_node; it must survive a re-encode.
  live_video_playlist: { uuid: uuid(4000), name: "Live Video", items: { items: [] } },
};

let cached: Uint8Array | undefined;

/** The synthetic document, encoded as ProPresenter would write it. */
export function syntheticMediaFile(): Uint8Array {
  cached ??= PlaylistDocument.encode(PlaylistDocument.fromObject(DOCUMENT)).finish();
  return cached;
}

/** Counts the tests assert against, kept next to the data that produces them. */
export const SYNTHETIC = {
  items: 13,
  playlistsWithItems: 4,
  emptyPlaylists: 1,
  video: 4,
  image: 9,
};

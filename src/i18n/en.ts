/**
 * English strings. This file is the canonical shape -- every other locale is
 * typed against it, so a missing or misspelled key fails the build rather than
 * silently rendering the key name.
 *
 * Counts use `plural`: [singular, plural]. Placeholders are `{name}`.
 */
export const en = {
  meta: {
    localeTag: "en",
    name: "English",
    quoteOpen: '"',
    quoteClose: '"',
    /** Separator before a value. French requires a narrow no-break space. */
    colon: ": ",
  },

  app: {
    title: "ProPresenter Garage",
    tagline: "Compare and audit media-bin playlists",
    schema: "schema {version}",
    offline: "runs offline",
    offlineHelp: "Files are read in your browser. Nothing is uploaded.",
    schemaHelp: "{files} proto files, generated {date}",
    languageLabel: "Language",
    themeLabel: "Appearance",
    footnoteBefore: "Schema from",
    footnoteLink: "ProPresenter7-Proto",
    footnoteAfter: "(unofficial). Not affiliated with Renewed Vision.",
  },

  slots: {
    baseline: "Baseline",
    compare: "Compare against",
    baselineHint: "Drop your Media file here, or click to pick it",
    compareHint: "Optional — drop a second Media file to see what changed",
    replace: "Replace",
    items: ["{n} item", "{n} items"],
    playlists: ["{n} playlist", "{n} playlists"],
    appOn: "ProPresenter {version} · {platform}",
  },

  fidelity: {
    identical: "lossless",
    equivalent: "lossless*",
    lossy: "lossy — do not export",
    identicalHelp: "Re-encoding this file reproduces it byte for byte, so exporting is safe.",
    equivalentHelp:
      "Re-encoding changes the byte layout but not the content, so nothing would be lost on export.",
    lossyHelp:
      "Re-encoding this file loses content — it contains something the schema does not cover. Exporting could corrupt your library.",
  },

  errors: {
    empty: "That file is empty.",
    notProtobuf: "Not a ProPresenter playlist file (protobuf decode failed: {reason})",
    wrongPlaylistType:
      'This is a {type} playlist, not a media playlist. Pick the file named "Media" from your ProPresenter folder.',
    playlistType: {
      unknown: "unknown",
      presentation: "presentation",
      media: "media",
      audio: "audio",
    },
  },

  start: {
    heading: "Load a Media playlist file to begin",
    whereWindows: "On Windows it lives in",
    whereMac: "on macOS in",
    noExtension: "It has no file extension.",
    oneOrTwo: "One file gives you an audit. Two files give you a diff.",
  },

  tabs: {
    diff: "Diff",
    audit: "Audit",
    browse: "Browse",
    diffDisabled: "Load a second file to compare",
    baselineSuffix: "(baseline)",
  },

  diff: {
    summary: "Summary",
    identical: "The two files describe an identical media library.",
    changeCount: ["{n} change across {from} → {to} items.", "{n} changes across {from} → {to} items."],
    playlistStructure: "Playlist structure",
    changes: "Changes",
    method:
      "Matched on item UUID first, then on media path. Comparison ignores the stored absolute paths, so moving a library between machines or folders is not reported as a change.",
    pathMatch: "path match",
    pathMatchHelp: "matched on file path, not UUID",
    inPlaylist: "in {playlist}",
    root: "(root)",
    unmodified: "unmodified",
    wasIn: "was in {playlist}",
    nowIn: "now in {playlist}",
    types: {
      added: "Added",
      removed: "Removed",
      moved: "Moved",
      renamed: "Renamed",
      relinked: "Relinked",
      restyled: "Restyled",
      retimed: "Retimed",
    },
    explain: {
      added: "media present in the newer file only",
      removed: "media present in the older file only",
      moved: "same media, different playlist",
      renamed: "same media, different label in ProPresenter",
      relinked: "same item, now pointing at a different file",
      restyled: "same media, changed mirroring, crop or effects",
      retimed: "same media, changed playback or transition settings",
    },
    playlistTypes: {
      added: "new playlist",
      removed: "playlist no longer present",
      renamed: "renamed",
    },
  },

  playback: {
    transitionDuration: "transition duration",
    playbackBehavior: "playback",
    endBehavior: "end behaviour",
    timesToLoop: "loop count",
    loopTime: "loop time",
    softLoop: "soft loop",
    markerCount: "markers",
    effectCount: "effects",
    seconds: "{n}s",
    none: "—",
    yes: "yes",
    no: "no",
  },

  mods: {
    mirroredHorizontally: "mirrored horizontally",
    mirroredVertically: "mirrored vertically",
    rotated: "rotated {degrees}°",
    blurred: "blurred",
    alphaInverted: "alpha inverted",
    cropped: "cropped",
    effect: "effect: {name}",
    effectOff: "effect: {name} (off)",
    scale: "scale {value}",
    align: "align {value}",
  },

  library: {
    heading: "Library",
    appOn: "ProPresenter {version} on {platform}",
    items: "Items",
    playlists: "Playlists",
    video: "Video",
    image: "Image",
    audio: "Audio",
    other: "Other",
    modified: "Modified",
  },

  audit: {
    heading: "Findings",
    method:
      "Two entries count as duplicates only when they share a file and an identical set of modifications. Same file with different mirroring, cropping or effects is a deliberate variant, listed separately.",
    nothing: "Nothing worth flagging.",
    more: ["{n} more", "{n} more"],

    withinPlaylist: "Repeated inside one playlist",
    withinPlaylistWhy:
      "The same file with the same modifications appears more than once in a single playlist. Rarely deliberate.",
    labelled: "labelled {labels}",
    allWith: "all with: {mods}",

    crossPlaylist: "Identical entries across playlists",
    crossPlaylistWhy:
      "One file, one set of modifications, reachable from several playlists. Usually deliberate categorisation — but where the labels disagree it is worth checking which name is the right one.",

    variants: "Variants of one file",
    variantsWhy:
      "These entries share a source file but each applies its own modifications, so they are genuinely different content. Not a problem — shown because ProPresenter itself gives you no way to see which variants exist.",
    unnamed: "(unnamed)",

    locations: "Inconsistent stored locations",
    locationsWhy:
      "Items record different absolute roots, meaning the library has moved between folders, user accounts or machines. Harmless in itself — ProPresenter resolves media through the relative path — and this tool compares on the relative path for exactly that reason.",
    locationCount: ["{n} item", "{n} items"],

    external: "Media on external volumes",
    externalWhy:
      "These resolve against a named drive rather than the ProPresenter folder. They go missing whenever that drive is not mounted.",

    empty: "Empty playlists",
    emptyWhy: "Playlists holding no media and no sub-playlists.",

    hidden: "Hidden items",
    hiddenWhy: "Marked hidden in ProPresenter, so they will not show in the bin.",

    nameMismatch: "Label differs from filename",
    nameMismatchWhy:
      "Unmodified entries whose label does not resemble the file they point at. Renaming is normal, so most of these are fine — occasionally it is the trace of a mis-linked item.",
  },

  browse: {
    heading: "Browse",
    subtitle: "{items} across {playlists}.",
    items: ["{n} item", "{n} items"],
    playlists: ["{n} playlist", "{n} playlists"],
    search: "Search items, filenames or playlists…",
    matches: ["{n} match", "{n} matches"],
    itemCount: ["{n} item", "{n} items"],
    subCount: "{n} sub",
    empty: "empty",
    unnamed: "(unnamed)",
  },

  themes: {
    system: "System",
    light: "Light",
    dark: "Dark",
  },

  units: {
    bytes: "{n} B",
    kilobytes: "{n} KB",
    megabytes: "{n} MB",
  },

  kinds: {
    video: "video",
    image: "image",
    audio: "audio",
    live_video: "live video",
    other: "other",
  },
};

/**
 * The shape every locale must satisfy. Intentionally *not* `as const`: literal
 * types here would mean French could only repeat the English wording.
 */
export type Dictionary = typeof en;

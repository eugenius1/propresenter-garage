// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

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
    offline: "Runs offline",
    offlineHelp: "Files are read in your browser. Nothing is uploaded.",
    schemaHelp: "{files} proto files, built {date}",
    languageLabel: "Language",
    toolLabel: "Tool",
    themeLabel: "Appearance",
    copyright: "\u00a9 {years} Eusebius Ngemera",
    footnoteBefore: "Schema {version} from",
    footnoteLink: "greyshirtguy/ProPresenter7-Proto",
    footnoteAfter: "Not affiliated with Renewed Vision.",
    updateReady: "A new version is available.",
    updateNow: "Reload",
    updating: "Reloading\u2026",
    updateLater: "Dismiss",
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
    wrongPlaylistType: "This is a {actual} playlist, not a {expected} playlist.",
    playlistType: {
      unknown: "unknown",
      presentation: "presentation",
      media: "media",
      audio: "audio",
    },
    /** Appended by a tool that knows which file it wants. */
    pickFileHint: 'Pick the file named "{filename}" from your ProPresenter folder.',
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
      recreated: "deleted and made again — {before} items before, {after} after",
    },
    /** Tag for a playlist that was deleted and recreated under the same name. */
    recreated: "Recreated",
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

  tools: {
    presentations: {
      name: "Presentations",
      tagline: "Check the text of every presentation in a library",

      pickFolder: "Choose a folder…",
      pickFiles: "Choose .pro files…",
      scanning: "Reading {n}…",
      chooseHint:
        "Pick your ProPresenter workspace, or its Libraries folder. Everything inside is read in your browser; nothing is uploaded.",
      readwriteNote:
        "This browser can read the folder and save fixes back to it.",
      readonlyNote:
        "This browser can read a folder but cannot write to it. Safari and Firefox offer no way back to the original files — use Chrome or Edge if you want fixes saved in place.",
      unavailableNote:
        "This browser cannot read a folder. Pick the .pro files individually instead.",
      installNote:
        "Installing the app makes the permission stick: in a tab it lapses when you close the last one.",

      found: ["{n} presentation", "{n} presentations"],
      noneFound: "No .pro files found in {folder}. Presentations live in the Libraries folder of a ProPresenter workspace — pick that, or the workspace itself.",
      pickerFailed:
        "The folder picker was unavailable, so the files were read as copies instead. Fixes cannot be saved back this way.",
      summary: "Summary",
      changeFolder: "Change",
      clearFolder: "Clear",
      remembered: "{folder} was open last time.",
      reconnect: "Reopen {folder}",
      reconnectWhy:
        "Permission to read the folder lapsed when the tab closed. Reopening needs one click; installing the app makes it stick.",
      forgetFolder: "Forget this folder",
      clean: "No text problems found.",
      issuesFound: ["{n} problem in {files}", "{n} problems in {files}"],
      inFiles: ["{n} file", "{n} files"],
      slidesAndBoxes: "{slides} slides · {empty} empty text boxes",
      problems: {
        empty: "This file is empty.",
        notPresentation:
          "This is a text file, not a ProPresenter presentation. Chord charts use the .pro extension too, so a ChordPro or OnSong file sitting in a library looks like one until it is opened.",
        unreadable: "Could not be read: {reason}",
      },

      slide: "slide {n}",
      line: "line {n}",
      kinds: {
        leadingSpace: "Leading space",
        trailingSpace: "Trailing space",
        blankLine: "Blank line",
        repeatedSpace: "Double space",
        trailingComma: "Trailing comma",
        trailingSemicolon: "Trailing semicolon",
        trailingFullStop: "Trailing full stop",
      },
      why: {
        leadingSpace: "The line begins with a space, which shifts it right on screen.",
        trailingSpace: "The line ends with a space. Invisible in the editor, but it affects centring.",
        blankLine: "A line between two lines of text that shows nothing — it leaves a gap on the slide.",
        repeatedSpace: "Two or more spaces in a row inside the line.",
        trailingComma:
          "The line ends with a comma. Fine in prose, but it reads oddly at the end of a slide.",
        trailingSemicolon:
          "The line ends with a semicolon, which almost never survives being broken across slides.",
        trailingFullStop:
          "The line ends with a full stop. A line trailing off into the next slide is written with an ellipsis, which is left alone.",
      },
      emptyBoxesNote:
        "Text boxes with no text at all are counted, not listed: ProPresenter themes leave them on slides as a matter of course.",
      optionalChecks: {
        trailingComma: "Also look for trailing commas",
        trailingSemicolon: "Also look for trailing semicolons",
        trailingFullStop: "Also look for trailing full stops",
      },
      optionalWhy: {
        trailingComma:
          "Off by default: a comma at the end of a line is ordinary punctuation, and whether it belongs on a slide is a matter of house style.",
        trailingSemicolon:
          "Off by default, and rare: 43 lines in a library of 24,000 end with one.",
        trailingFullStop:
          "Off by default, and much the commonest of the three: a house that strips commas may well keep the full stop that ends a verse.",
      },
      showAll: "Show all {n}",

      fix: "Fix these",
      fixHint:
        "Nothing is written until you have a backup and have chosen what to change. Every line is shown as it is now and as it would read.",
      fixable: ["{n} line can be fixed", "{n} lines can be fixed"],
      inFilesFix: ["in {n} file", "in {n} files"],
      selectAll: "Select all",
      selectNone: "Select none",
      selectFile: "Select every line in this file",
      becomes: "becomes",
      lineRemoved: "the line is removed",
      noFixFor: "No automatic fix — this line has to be edited in ProPresenter.",
      downloadBackup: "Download a backup first",
      backupCount: ["Backs up {n} file", "Backs up {n} files"],
      backupDone: "Backed up as {name}.",
      backupStale: "Your selection now covers files the backup does not. Download it again.",
      backupWhy:
        "A zip of the files as they are now, saved to your downloads. Keep it until you have opened the songs in ProPresenter and are happy with them.",
      applyFixes: ["Fix {n} line", "Fix {n} lines"],
      applying: "Saving {n}…",
      backingUp: "Backing up {n}…",
      fixing: "Fixing {n}…",
      progressCount: "{done} of {total}",
      fixedFiles: ["{n} file fixed", "{n} files fixed"],
      fixedNone: "Nothing was changed.",
      fixFailed: ["{n} file was left alone", "{n} files were left alone"],
      downloadFixed: "Download the fixed files",
      downloadFixedWhy:
        "This browser cannot write to the folder, so the fixed presentations come as a zip instead. Move them into your library yourself, keeping the originals until you are happy with them.",
      downloadedFixed: "Saved as {name}. Your library has not been touched.",
      permissionNeeded:
        "Saving needs permission to write to the folder. Choose the folder again and allow editing.",
      refusals: {
        lossy:
          "this file uses something the schema does not cover, so saving it could lose data",
        unreadable: "this file could not be read",
        unchanged: "nothing was selected in this file",
        verifyFailed: "the result did not read back as expected, so it was not saved",
        writeFailed: "the folder would not accept the file",
        stale: "this file changed since it was scanned, so the fix no longer fits it",
      },
    },
    mediaBin: {
      name: "Media Bin",
      tagline: "Compare and audit media-bin playlists",

      baseline: "Baseline",
      compare: "Compare against",
      baselineHint: "Drop your Media file here, or click to pick it",
      compareHint: "Optional — drop a second Media file to see what changed",
      baselineSuffix: "(baseline)",
      pickFileHint:
        'Pick the file named "Media" from the Playlists folder of your ProPresenter workspace.',

      startHeading: "Load a Media playlist file to begin",
      whereIntro:
        "It is the file named Media, with no extension, in the Playlists folder of your ProPresenter workspace.",
      whereWindows: "Windows",
      whereMac: "macOS",
      whereLegacy: "ProPresenter 19 and below, either platform",
      whereWorkspaceNote:
        "ProPresenter 20 moved the workspace out of Documents. The folder shown as {placeholder} is named after your workspace — usually ProPresenter unless you renamed it.",
      oneOrTwo: "One file gives you an audit. Two files give you a diff.",

      replace: "Replace",
      items: ["{n} item", "{n} items"],
      playlists: ["{n} playlist", "{n} playlists"],
      appOn: "ProPresenter {version} · {platform}",

      diffDisabled: "Load a second file to compare",
      tabs: {
        diff: "Diff",
        audit: "Audit",
        browse: "Browse",
        reorganise: "Reorganise",
      },

      merge: {
        heading: "Bring changes across",
        intro:
          "Pick changes and apply them to one side, then export it. The file you load is never written to — export produces a separate copy.",
        direction: "Apply to",
        intoBaseline: "Baseline ({filename})",
        intoCompare: "Compare ({filename})",
        selectAll: "Select all",
        selectNone: "Clear selection",
        selected: ["{n} change selected", "{n} changes selected"],
        applyAndExport: "Apply and export",
        blocked: ["{n} change cannot be applied", "{n} changes cannot be applied"],
        blockedWhy: "Their entry could not be found in the file it came from.",
        blockedDestructive:
          "A recreated playlist cannot be brought across: it would mean deleting this side's playlist and everything in it.",
        willCreate: ["Creates {n} playlist: {names}", "Creates {n} playlists: {names}"],
        exportBlocked:
          "That side cannot be exported: re-encoding it loses content the schema does not cover.",
        exportedAs: "Exported as {filename}. Check it in ProPresenter before replacing anything.",
        failed: "Those changes could not be applied together: {reason}",
        nothingSelected: "Nothing selected.",
      },

      reorganise: {
        heading: "Reorganise",
        intro:
          "Changes are collected here and applied only when you export. Your original file is never written to — export produces a separate copy for you to put in place yourself.",
        pending: ["{n} pending change", "{n} pending changes"],
        none: "No changes yet.",
        undo: "Undo last",
        discard: "Discard all",
        exportFile: "Export file",
        exportBlocked:
          "This file cannot be exported: re-encoding it loses content the schema does not cover.",
        exportedAs: "Exported as {filename}. Check it in ProPresenter before replacing anything.",
        broken:
          "These changes no longer apply to this file. Undo the last one, or discard them all.",

        quickFixes: "Quick fixes",
        quickFixesWhy:
          "Built from the audit. Each one queues ordinary changes you can review and undo below.",
        removeDuplicates: ["Remove {n} duplicate entry", "Remove {n} duplicate entries"],
        removeDuplicatesWhy:
          "Keeps the first of each entry repeated inside a single playlist, with identical modifications.",
        removeEmpty: ["Remove {n} empty playlist", "Remove {n} empty playlists"],
        removeEmptyWhy: "Playlists holding no media and no sub-playlists.",
        showAffected: "Show what this changes",
        affectedItem: "{name} — in {playlist}",
        viewInAudit: "See in Audit",
        keeping: "keeping {name}",
        differentName: "different name — check which to keep",
        nothingToFix: "The audit found nothing to fix automatically.",

        rename: "Rename",
        remove: "Remove",
        moveUp: "Move up",
        moveDown: "Move down",
        moveTo: "Move to…",
        renameItemPrompt: "New name for this item",
        renamePlaylistPrompt: "New name for this playlist",
        removePlaylistConfirm:
          "Remove {name} and the {n} items in it? You can still undo this before exporting.",
        emptyPlaylist: "empty",
      },
    },
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

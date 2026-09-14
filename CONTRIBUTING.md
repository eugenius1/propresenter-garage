<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Eusebius Ngemera -->

# Developing ProPresenter Garage

Everything a contributor needs. The [README](README.md) is for people using the
app; this is for people changing it; [AGENTS.md](AGENTS.md) holds the handful
of rules that bind coding agents specifically.

## Running it

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/`. `npm test` runs the suite, and
`npm run check` is the same gate CI uses: codegen, lint, both typechecks, tests.

Pushing to `main` deploys to GitHub Pages. The site needs a real HTTP server
even though it is entirely static — ES modules and service workers are both
blocked on `file://`.

`npm run check` is the gate, and it is the one CI runs. Run it before every
commit — it includes the codegen step, so it also catches the case where a
clean checkout would not build.

## How it reads the files

ProPresenter 7 stores its data as Google protocol buffers. The schema is not
published, so this uses the reverse-engineered definitions from
[greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto)
(MIT), vendored in `proto/`.

`npm run protos:update [ref]` re-vendors from upstream and records the exact
commit in [`proto/PROVENANCE.json`](proto/PROVENANCE.json), which the build
threads into the interface — the footer names the commit, so a reported
problem can be tied to an exact set of definitions. The update prints
an added/removed summary, and the resulting diff is reviewable before you
commit it.

**Why vendored rather than a git submodule.** A submodule pins a commit, which
is the part worth having, and we get that from the provenance file instead. What
a submodule also brings is a clone that needs `--recurse-submodules` and CI that
needs submodule support — forget either and you get an empty `proto/` and a
confusing build failure. And since upstream is an unofficial reverse-engineered
schema, a rewrite or takedown would break a submodule while leaving a vendored
copy untouched. That independence is worth 161 text files.

`npm run protos` collapses the 36 transitively-imported `.proto` files into a
single JSON descriptor (98 KB, 19 KB gzipped) at build time, so the app loads
the schema via `Root.fromJSON()` instead of parsing schema text at runtime.

A media-bin file is one `rv.data.PlaylistDocument` with `type = TYPE_MEDIA`,
holding a recursive `Playlist` tree.

## Three things worth knowing

These each cost a debugging session to find, and each one shapes the code.

**Compare on relative paths, never absolute ones.** Every item stores both an
`absolute_string` and a `ROOT_*`-relative path. Real libraries accumulate
inconsistent absolute paths as they move — one 482-item library held five
different roots, spanning three Windows user accounts and a macOS `file://`
URL, while every relative path stayed consistent. Diffing on the absolute path
reports a moved library as "everything changed".

**Detect moves by playlist UUID, not playlist path.** An item's path is derived
from its ancestors' names, so renaming one playlist rewrites the path of
everything inside it. Comparing paths turned a single rename into 22 phantom
"moved" rows.

**Same file ≠ duplicate.** ProPresenter stores mirroring, rotation, cropping,
blur and effects *per entry*, in `Media.DrawingProperties`. Two entries can
point at one file and be genuinely different content — the same photo flipped,
or the same map recoloured via a `Color Swap` effect. Duplicate detection
compares the file path *and* a fingerprint of those modifications.

Scale behaviour and alignment are deliberately excluded from that fingerprint.
They look like modifications but are applied on import rather than chosen: in
the same library, 331 of 482 items carried `BEHAVIOR_FILL` and the other 144
carried nothing, tracking *when* each item was added. Including them split real
duplicates into false variants.

## Localisation

Adding a locale means one file. `src/i18n/en.ts` is the canonical shape and
every other dictionary is typed against it, so a missing or misspelled key is a
build error rather than an English string leaking through. Tests additionally
assert that the locales share every key, that plural lists have matching
arity, that placeholders line up, and that no French string is accidentally
still the English one.

Three things the translation layer does properly rather than approximately:

- **Plurals via `Intl.PluralRules`, not `n === 1`.** French takes the singular
  for zero ("0 élément"), English the plural ("0 items").
- **What stays untranslated.** File paths, effect names (`Adjust Color`), effect
  variable names (`Brightness=0.2`) and schema enum values (`BEHAVIOR_FILL`,
  `STOP`) are ProPresenter's own vocabulary. Translating them would make them
  harder to match against what ProPresenter shows, not easier.
- **Analysis is language-independent.** The duplicate fingerprint is built from
  structural descriptors, never from display strings, so what counts as a
  duplicate never shifts with the interface language. An earlier version built
  it out of English prose; a French reader would have seen a different set of
  duplicates. `ModDescriptor` exists for exactly this reason, and the diff
  returns structured `ChangeDetail` values rather than sentences for the same
  one.

## The export safety gate

protobuf.js discards fields absent from the schema. Since the schema is
reverse-engineered, a field ProPresenter writes but the protos omit would
vanish on re-encode and quietly corrupt a library.

So every loaded file is decoded, immediately re-encoded, and checked. The
result is one of:

| Verdict | Meaning |
| --- | --- |
| `identical` | Byte-for-byte match. Safest possible result. |
| `equivalent` | Bytes differ, decoded content does not — the original was encoded non-canonically. Nothing would be lost. |
| `lossy` | Decoded content differs. Something is uncovered by the schema; writing this file back could corrupt it. |

Real ProPresenter 21.4.2 files verify as `identical`, which is what makes a
write path viable at all. Any future write feature must refuse to touch a file
rated `lossy`, and must emit a new file rather than overwrite the original.

## Testing against real files

Real ProPresenter files are somebody's actual media library and are not
committed. Point the suite at one:

```bash
PP_MEDIA_FILE=/path/to/ProPresenter/Playlists/Media \
PP_LIBRARY_DIR=/path/to/ProPresenter/Libraries npm test
```

`PP_MEDIA_FILE` is the media-bin playlist the diff and audit tests work from;
`PP_LIBRARY_DIR` is the folder of `.pro` files the presentation checker works
from. They default to `~/dev/me/ProPresenter/Media` and
`~/dev/me/ProPresenter/Libraries`, and every test that needs a real file skips
cleanly when none is present, so CI stays green without them. They work by decoding a real library,
mutating a clone (moving an item, renaming a playlist, mirroring an image,
disabling an effect) and asserting the diff reports exactly that change and
nothing else.

`scripts/make-mutated-sample.mjs` generates a plausibly-edited copy of a real
file, which is handy for exercising the diff UI without waiting for two genuine
weekly snapshots.

## Things that will bite you

Each of these has already cost someone a debugging session, and several have
been shipped as bugs and fixed. They are listed so the next person does not
rediscover them.

**Never store a formatted string in state.** Store the error or the value and
format it at render. `FileSlot` once kept the formatted error message, so
switching language left the old language's text on screen with nothing to
re-render. This is the same class of mistake as building the duplicate
fingerprint out of English prose.

**Read fixture files in `beforeAll`, never in a `describe` body.** Vitest
executes a describe body during collection *even for a suite `skipIf` will
skip*, so a `readdirSync` there throws on any machine without a real library.
This has been fixed twice; the second time it turned CI red after a push.

**RTF spaces are not all content.** A control word is terminated by a single
space that is syntax: in `\cb2 Que ton nom`, the space after `\cb2` is a
delimiter. Matching spaces with a regular expression reports a leading space on
nearly every line in every file. `src/lib/rtf.ts` exists solely for this, and
the text it returns is a *projection* — writing a fix means editing the
original RTF, not the extracted string.

**The browser never reveals a folder's path.** `showDirectoryPicker` hands back
a handle carrying a name and nothing more, and the `webkitdirectory` fallback
gives paths relative to the chosen folder. Do not build interface text that
implies a full path is available.

**Folder permission lapses when the last tab for the origin closes.** An
installed app keeps it; a plain tab does not. Re-requesting needs a user
gesture, so offer a button rather than re-requesting on load --
`handlePermission` and `requestHandlePermission` in `src/lib/persistence.ts`
model this.

**Only Chromium can write to a folder at all.** `folderAccess()` returns
`readwrite` (File System Access API), `readonly` (`<input webkitdirectory>`,
which hands over copies with no path back to the originals) or `unavailable`.
Every writing feature needs a non-writing fallback, or Safari and Firefox get a
dead button.

**Revoking a blob URL synchronously after `click()` races the download.** It
fails in Safari. The download helpers defer the revoke and append the anchor to
the document; copy them rather than writing a third variant.

**Empty text boxes are counted, not reported.** ProPresenter's themes leave
placeholders on slides as a matter of course — 77 across three real files --
so listing each as a problem buries the findings that matter. A blank line is
only an issue when it sits *between* lines that have text; a leading or
trailing one is padding.

**Specificity beats intent in CSS.** `.btn:hover:not(:disabled)` outranks
`.btn.primary`, so an unscoped hover rule replaced the accent background while
the label stayed white and the button looked empty. Scope hover rules away from
the variants they should not touch.

**Contrast is measured, not judged.** `src/lib/__tests__/contrast.test.ts`
reads the Radix scales straight from the package and asserts the pairings the
stylesheet actually makes. White on blue step 9 measures 3.26:1 and fails AA;
that is why the accent is indigo. Add a pairing to that file rather than
eyeballing a new colour.

## Conventions

- **`npm run check` must pass.** Codegen, `oxlint`, both TypeScript projects,
  and the full suite.
- **Every source file** opens with `// SPDX-License-Identifier: GPL-3.0-or-later`
  and `// Copyright (C) 2026 Eusebius Ngemera`.
- **Comments explain why, not what.** `src/lib/rtf.ts` and `src/lib/decode.ts`
  are the register to aim for: each one says what went wrong without it.
- **Every user-visible string goes in both dictionaries.** `src/i18n/en.ts` is
  canonical and `fr.ts` is typed against it; tests assert matching keys, plural
  arity, placeholders, and that no French string is accidentally the English
  one.
- **Never write over an original ProPresenter file.** `exportFilename()` in
  `src/lib/operations.ts` exists for this — exports are always a differently
  named copy that the reader moves into place themselves.
- **Never commit a real ProPresenter library.** Real `.pro` files, media-bin
  playlists and media folders are somebody's personal data. `public/__dev-*` is
  gitignored for exactly this; development copies go there and nowhere else.
- **Commit messages are prose.** Explain the reasoning and what went wrong, not
  a changelog line.

Coding agents have a few rules of their own — attribution, and what must never
be committed or overwritten. Those live in [AGENTS.md](AGENTS.md), which Claude
Code and other agents load automatically, rather than being buried in a list
they may never read.

## Layout

`src/App.tsx` is the shell — title, appearance and language controls, the tool
switcher, licence — and renders the active tool. Each tool under `src/tools/`
owns everything specific to it, including its own file state, and its strings
live under its own key in the dictionaries. Shared analysis lives in
`src/lib/`, shared interface pieces in `src/components/`.

Routing is a flat list of slugs in `App.tsx`: the first tool owns the root path
and each other tool gets one segment. There is no registry and no extension
point, because two tools share nothing but the chrome around them — one reads
a playlist document, the other a folder of presentations.

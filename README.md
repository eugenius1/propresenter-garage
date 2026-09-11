# ProPresenter Garage

An installable web app holding a suite of utilities for ProPresenter 7 files.

Everything runs in the browser. No server, no upload: your media library never
leaves the machine, and once installed the app works with no network at all.

## Tools

### Media Bin

Compares and audits **media-bin playlists** — the file named `Media` in your
ProPresenter folder. Load one file to audit it; load two to see exactly what
changed between them.

Planned: reorganising and exporting (see [the export safety gate](#the-export-safety-gate)),
then presentation playlists and the library.

## Why

ProPresenter gives you no way to answer "what changed in the media bin since
last week?", or "is this file in here twice?". Nothing existing fills that gap
either — the community projects around ProPresenter are either live remote
controls (ProWebRemote, ProPresenter-API) or parsers for the pre-7 XML format
(ProPresenter-Parser). This reads the actual Pro7 files.

The name is deliberate: a garage is where the tools live, so new ones can be
added without the name fighting them.

## Running it

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/` you can host anywhere, including
offline from the filesystem. `npm test` runs the suite.

## How it reads the files

ProPresenter 7 stores its data as Google protocol buffers. The schema is not
published, so this uses the reverse-engineered definitions from
[greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto)
(MIT), vendored in `proto/`.

`npm run protos:update [ref]` re-vendors from upstream and records the exact
commit in [`proto/PROVENANCE.json`](proto/PROVENANCE.json), which the build
threads into the interface — the schema chip's tooltip names the commit, so a
reported problem can be tied to an exact set of definitions. The update prints
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

## Languages

English and French. The default comes from the device — `navigator.languages`
in preference order, ignoring region subtags, so a machine configured as
`[de, fr, en]` gets French rather than falling through to English. A switcher
top right overrides it and the choice is remembered, for the case the device
cannot express: a French operator on an English-configured booth machine.

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
PP_MEDIA_FILE=/path/to/ProPresenter/Media npm test
```

It defaults to `~/dev/me/ProPresenter/Media`, and the tests that need a real
file skip cleanly when none is present. They work by decoding a real library,
mutating a clone (moving an item, renaming a playlist, mirroring an image,
disabling an effect) and asserting the diff reports exactly that change and
nothing else.

`scripts/make-mutated-sample.mjs` generates a plausibly-edited copy of a real
file, which is handy for exercising the diff UI without waiting for two genuine
weekly snapshots.

## Status

Implemented: the Media Bin tool — diff, audit, browse — plus the fidelity gate,
English/French localisation, and light/dark/system appearance.

Not yet implemented: reorganising and exporting. The gate above is the
prerequisite, and it passes on real files — so the remaining work is the
editing UI, not the file writing. The app is also still a single tool rather
than a shell with several; navigation arrives with the second tool.

## Licence

Copyright (C) 2026 Eusebius Ngemera

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details. You
should have received a copy of the licence along with this program — see
[LICENSE](LICENSE), or <https://www.gnu.org/licenses/>.

Source files carry an [SPDX](https://spdx.dev/) header rather than the full
notice, which keeps them readable while staying machine-checkable.

The vendored schema in `proto/` is a separate work, MIT-licensed by its author
and kept under its own notice at
[`proto/LICENSE-ProPresenter7-Proto`](proto/LICENSE-ProPresenter7-Proto). MIT is
GPL-compatible, so the combination distributes cleanly under the GPL.

---

Not affiliated with Renewed Vision. The proto definitions are unofficial and
unsupported; back up your ProPresenter folder before trusting any tool with it.

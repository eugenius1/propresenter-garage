# ProPresenter Garage

An installable web app holding a suite of utilities for ProPresenter 7 files.

**<https://eusebius.tech/propresenter-garage/>**

Everything runs in the browser. No server, no upload: your media library never
leaves the machine, and once installed the app works with no network at all.

## Tools

### Presentations

Checks the text of every presentation in a library — a whole folder of `.pro`
files at once. It finds the things nobody spots by opening thirty songs one at
a time: a space at the start of a line that shifts it right on screen, a space
at the end that spoils centring, a doubled space, and lines that show nothing
while still taking up room. Trailing commas can be checked too, switched on
separately since whether they belong on a slide is a matter of house style.

It reports; it does not yet change anything.

### Media Bin

Compares and audits **media-bin playlists** — the file named `Media` inside
your ProPresenter folder's `Playlists` directory. (`Media` at the top level of
that folder is the media *assets*; the playlist document is the one under
`Playlists`.) Load one file to audit it; load two to see exactly what changed
between them, bring changes from one side into the other, and export the
result as a new file.

## Why

ProPresenter gives you no way to answer "what changed in the media bin since
last week?", or "is this file in here twice?". Nothing existing fills that gap
either — the community projects around ProPresenter are either live remote
controls (ProWebRemote, ProPresenter-API) or parsers for the pre-7 XML format
(ProPresenter-Parser). This reads the actual Pro7 files.

The name is deliberate: a garage is where the tools live, so new ones can be
added without the name fighting them.

## What your browser can do

Reading works everywhere. Writing back does not: Chrome and Edge can be given
access to a folder and, in time, save fixes into it, while Safari and Firefox
can only read copies — they offer no way back to the original files. Both are
offered automatically; you do not choose between them.

Installing the app changes one thing: permission to read a folder sticks,
rather than lapsing when you close the last tab.

## Languages

English and French. The default comes from the device — `navigator.languages`
in preference order, ignoring region subtags, so a machine configured as
`[de, fr, en]` gets French rather than falling through to English. A switcher
top right overrides it and the choice is remembered, for the case the device
cannot express: a French operator on an English-configured booth machine.

## Status

Working: the **Presentations** checker, and the **Media Bin** tool — diff,
audit, browse, reorganise and export — with the fidelity gate behind every
export, English and French, and light, dark or system appearance.

Not yet: fixing the presentation problems it finds, rather than only reporting
them. The [export safety gate](CONTRIBUTING.md#the-export-safety-gate) is the
prerequisite and it passes on real files, so what remains is the editing and
backup design rather than the file writing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — how the files are read, the
invariants the diff depends on, the safety gate, and the traps worth knowing
before changing anything. Coding agents should start at
[AGENTS.md](AGENTS.md).

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

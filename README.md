# ProPresenter Garage

[![CI](https://github.com/eugenius1/propresenter-garage/actions/workflows/ci.yml/badge.svg)](https://github.com/eugenius1/propresenter-garage/actions/workflows/ci.yml)
[![Deploy](https://github.com/eugenius1/propresenter-garage/actions/workflows/deploy.yml/badge.svg)](https://github.com/eugenius1/propresenter-garage/actions/workflows/deploy.yml)
[![codecov](https://codecov.io/gh/eugenius1/propresenter-garage/graph/badge.svg)](https://codecov.io/gh/eugenius1/propresenter-garage)

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
while still taking up room.

Trailing punctuation is checked too — commas, semicolons and full stops — each
switched on separately, since whether they belong on a slide is a matter of
house style and not one decision: a library of 24,000 lines ends nearly a
thousand of them with a full stop and 43 with a semicolon, so a house that
strips commas may well keep the full stop that closes a verse. A line ending
in an ellipsis is left alone either way: that is a line running on into the
next slide, which is the opposite of the problem.

It can also put them right. Every fix is shown first as the line is now and
as it would read, one row per line and a tick beside each, so nothing is
changed that you have not looked at. In Chrome and Edge the corrected files go
back into the folder — but only after you have downloaded a zip of those files
exactly as they stand, which the button insists on. Everywhere else, the
corrected presentations come as a zip for you to move into place yourself, and
your library is not touched at all.

Behind that: each file is checked against the schema before it is written, and
read back afterwards to confirm it says what was promised. Anything that fails
either check is left exactly as it was and named in the results.

### Media Bin

Compares and audits **media-bin playlists** — the file named `Media` inside
your ProPresenter folder's `Playlists` directory. (`Media` at the top level of
that folder is the media *assets*; the playlist document is the one under
`Playlists`.) Load one file to audit it; load two to see exactly what changed
between them, bring changes from one side into the other, and export the
result as a new file.

### For AI assistants (MCP)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an
assistant such as Claude read your library from disk: list and search
presentations, read their slides line by line, run the Presentations checks,
and read or audit the media bin. It is **read-only** — it cannot change a file.

It also reads what each presentation records about itself: when ProPresenter
last edited it and last showed it, its category, notes, CCLI details, key and
arrangements. So it can answer "which songs haven't we used this year?" —
though that question opens every file, so it takes about a second per 500
songs rather than being instant. It gives no creation date: presentations
don't record one, and the file system's is reset by every copy, sync or
restore.

ProPresenter's own network API can show and trigger slides, and there are MCP
servers for that, but it cannot read a presentation's file or edit its text.
This works on the files instead, through the same code as the app.

It reads nothing outside the folders you give it. The usual one is
`Documents/ProPresenter`, which holds `Libraries` and `Playlists` on both macOS
and Windows.

#### Claude Desktop

The server is packaged as a desktop extension, so Claude Desktop installs it in
one click and brings its own Node; there is nothing else to install.

```bash
npm ci && npm run mcp:pack
```

1. Open `dist-mcp/propresenter-garage.mcpb` with Claude Desktop: double-click
   it, drag it onto the window, or install it from **Settings → Extensions**.
2. Click **Install**, then choose your ProPresenter folder when asked. It
   suggests `Documents/ProPresenter`; add more than one folder if you keep
   libraries elsewhere.
3. Start a new chat and ask, for example, *"Which songs in my library have
   lines ending in a full stop?"* or *"Find the presentation with the lyric
   'how great thou art'."*

To change the folders later, find ProPresenter Garage under **Settings →
Extensions**. The extension is unsigned, so Claude Desktop says so when
installing it.

#### Claude Code and other MCP clients

Any client that starts a local server over stdio — Claude Code, VS Code,
Cursor, Cline, LM Studio — can run the bundled file directly with Node 20 or
later:

```bash
npm ci && npm run mcp:build
claude mcp add propresenter -- node "$PWD/dist-mcp/propresenter-mcp.mjs" ~/Documents/ProPresenter
```

Pass one or more folders; with none, it reads `~/Documents/ProPresenter`. The
built file is self-contained, so it can be copied anywhere. Other clients take
the same command and arguments in their MCP settings.

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
access to a folder and save fixes into it, while Safari and Firefox can only
read copies — they offer no way back to the original files, so there the fixes
arrive as a zip instead. Both routes are offered automatically; you do not
choose between them.

Installing the app changes one thing: permission to read a folder sticks,
rather than lapsing when you close the last tab.

## Languages

English and French. The default comes from the device — `navigator.languages`
in preference order, ignoring region subtags, so a machine configured as
`[de, fr, en]` gets French rather than falling through to English. A switcher
top right overrides it and the choice is remembered, for the case the device
cannot express: a French operator on an English-configured booth machine.

## Status

Working: the **Presentations** checker and its fixes, and the **Media Bin**
tool — diff, audit, browse, reorganise and export — with the fidelity gate
behind everything written, English and French, and light, dark or system
appearance. Also the read-only **MCP server**; editing through it would have to
keep all four write guards in [AGENTS.md](AGENTS.md), so it is not offered yet.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — how the files are read, the
invariants the diff depends on, the safety gate, and the traps worth knowing
before changing anything. Coding agents should start at
[AGENTS.md](AGENTS.md).

## Licence

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details. You
should have received a copy of the licence along with this program — see
[LICENSE](LICENSE), or <https://www.gnu.org/licenses/>.

The vendored schema in `proto/` is a separate work, MIT-licensed by its author
and kept under its own notice at
[`proto/LICENSE-ProPresenter7-Proto`](proto/LICENSE-ProPresenter7-Proto). MIT is
GPL-compatible, so the combination distributes cleanly under the GPL.

---

Not affiliated with Renewed Vision. The proto definitions are unofficial and
unsupported; back up your ProPresenter folder before trusting any tool with it.

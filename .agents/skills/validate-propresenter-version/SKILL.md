---
name: validate-propresenter-version
description: Check the core library against a specific ProPresenter release by opening real files in the app itself. Use when asked to validate, verify or test against a new (or older) ProPresenter version, or to compare what ProPresenter shows with what the parser reports.
---

# Validating the core against a ProPresenter version

The test suite proves a file round-trips. This check proves ProPresenter
shows what the parser reports, and accepts what the core writes. Why that
matters is in [CONTRIBUTING.md](../../../CONTRIBUTING.md#checked-against-propresenter),
and what earlier runs found is in
[docs/propresenter-versions.md](../../../docs/propresenter-versions.md).

AGENTS.md's rules on real libraries and on writing ProPresenter files apply
throughout. Read them first.

## 1. Agree the scope with the user

Ask which version, and which machine's data. Then agree:

- **The apps you may control.** Normally ProPresenter only. Use computer use
  with nothing else granted.
- **What must not change.** Typically a sample library and a sample playlist.
- **Whether you may delete anything.** For example, a few media-bin entries
  to test an export. Get the number agreed.
- **Where the backup goes.** A folder the user can find later, e.g.
  `~/Documents/ProPresenter-backup-<date>`. Not your scratchpad, which goes
  away with the session.

## 2. Get the right build

Renewed Vision's download page,
https://renewedvision.com/propresenter/download, lists every version back to
7.0 for both platforms, with links. Take the link from the page rather than
building one. The names follow no single pattern:

- **macOS:** `mac/ProPresenter_<version>_<build>.zip`.
- **Windows:** `win/ProPresenter_<version>_<build>-Setup.exe` from 7.12 on,
  and `win/ProPresenter7.<x>.<y>_<build>-Setup.exe` before that.
- **Windows can differ from macOS.** It may have its own patch release and
  build, e.g. 21.4.2 on Windows against 21.4 on macOS.
- **Gaps.** A few old versions have no download for one platform.

If the download is gone, ask the user for the installer.

On macOS, every version shares one bundle identifier, so a second version
needs its own macOS user account and its own copy of the data. On Windows,
the installer most likely replaces the version already there, so plan on a
separate machine or virtual machine. That has not been tried yet; record what
works. On either platform, never point an older version at data a newer one
has saved.

Read the release notes (renewedvision.com/propresenter/release-notes) for
anything touching files, the library, playlists, the media bin, themes,
arrangements or workspaces. Report those to the user before you start.

## 3. Back up before anything else

The data folder is whatever ProPresenter's `applicationShowDirectory` setting
says, which is not always `~/Documents/ProPresenter`. Read it, then back up
the folders this procedure writes to and check the copy:

```bash
SHOW=$(defaults read com.renewedvision.propresenter applicationShowDirectory)
SHOW=${SHOW/#\~/$HOME}
B=~/Documents/ProPresenter-backup-$(date +%F)   # or the folder agreed in step 1
mkdir -p "$B" && cd "$SHOW" && cp -Rp Libraries Playlists Configuration "$B"/
for d in Libraries Playlists Configuration; do diff -rq "$d" "$B/$d"; done
```

Every later step works in `$SHOW`, not in a path assumed from these notes.

Leave `Media` out. It is gigabytes, and nothing here touches it.

## 4. Run the suite against the installation

Point `PP_LIBRARY_DIR` and `PP_MEDIA_FILE` at `$SHOW/Libraries` and
`$SHOW/Playlists/Media`, as
[CONTRIBUTING.md](../../../CONTRIBUTING.md#testing-against-real-files)
describes, and run `npm test`.

A test that fails here but passes in CI is a finding, not noise. It can also
be a test that assumes something about real data. Find out which before
changing anything.

## 5. Read what ProPresenter shows

Compare the parser with the app on a few files. Choose songs with sections,
a title slide, macros and accented text.

For the parser's view, use the project's MCP server when it is connected
(see `packages/mcp/README.md`). It needs no script:

- `read_presentation` numbers slides as ProPresenter does;
- `read_media_bin` reads the media bin;
- `check_presentations` runs the checks.

It has no tool yet for presentation playlists, themes, the dry-run plans
(`planStyle`, `planFixes`) or anything that writes. Use a short `npx tsx`
script against `packages/core/src/lib` for those.

- **Slide numbers.** Do they match `slidesInOrder()` in `presentation.ts`?
  ProPresenter numbers slides in group order, not in the order they are
  stored.
- **Text and groups.** Are each slide's text and group names as shown? Use
  the slide grid's text view to read them at full size.
- **Media kinds.** Are the media bin's videos, images and audio counted the
  way ProPresenter shows them?
- **Playlists.** Does each playlist open with every entry found?

## 6. Round-trip what the core writes

Write every test file first, then check them all in one ProPresenter
session. The functions are in `packages/core/src/lib`, and none of them
writes a file. Each returns bytes, and a short `npx tsx` script saves them:

- under a **new** name, such as `Song (Garage style).pro`, never over an
  existing file;
- after decoding with `decodePresentation`, giving the document a fresh uuid
  from `newUuid()` (`decode.ts`), and encoding with `encodePresentation`. A
  plain file copy keeps the original's uuid, and two documents claiming one
  identity is not something to test by accident.

The round-trips:

- **Fixer.** `planFixes`/`applyFixes` (`fixes.ts`) return the fixed bytes.
  The Presentations tool is what writes them back in place, under the
  conditions in AGENTS.md. Here, save them as a copy. The lines should read
  as promised, and the plan's slide numbers should match the app's.
- **Restyle.** `applyStyle` (`style.ts`) returns `{ bytes, plan }`. Run it
  once with a theme from `themeStyles()` and once with another song's slide
  from `presentationStyle()`. Check the plan before opening the file. The
  title slide is skipped only when it carries a macro the lyric slides do
  not. One with no macro needs its number in `skipSlides`. The title slide
  and macros should come out unchanged.
- **Media Bin export.** `exportOperations` (`operations.ts`) returns the
  edited bin's bytes. Remove the agreed entry with it. The bin should open
  without it.
- **Playlist.** Build one with `presentationEntry`, `headerEntry` and
  `mediaEntry` (`playlists.ts`), then reorder it, insert into it and rename it
  with `exportOperations`. It should open with every entry found, and every other playlist should
  be unchanged.

To check a core feature against ProPresenter's own, make two copies of the
same file, each with a fresh document uuid as above:

1. Do the operation in ProPresenter on one copy, e.g. right-click → Themes on
   the lyric slides.
2. Do it with the core on the other.
3. Decode both and diff them slide by slide, field by field:
   - the elements, their uuids and `info`;
   - the text attributes and the RTF;
   - everything outside `base_slide`.
4. Run the export safety gate (CONTRIBUTING.md) on ProPresenter's copy as
   well.

ProPresenter saves an edited presentation only when you switch to another
one. Check the file's modification time before reading it.

When it saves, it rewrites the whole file. It upper-cases uuids, drops empty
notes, rewrites `application_info`, and re-serialises the RTF, e.g. `\'e9`
where the core writes `\u233 ?`. That is not part of the operation. Compare
the words that `extractLines` gives, not the RTF bytes, and set the re-save
noise aside before calling anything a difference.

### Replacing the playlist files

ProPresenter keeps `Playlists/Library` and `Playlists/Media` in memory and
writes them when it quits. To replace them:

1. Quit ProPresenter, and confirm the quit dialog.
2. Check both files still match the backup.
3. Copy in both replacements together.
4. Relaunch once.
5. Check ProPresenter did not rewrite them.

## 7. Driving ProPresenter

- **Never trigger a slide.** Clicking a slide in Show mode sends it to the
  output. Switch to Edit mode before selecting slides.
- **Background first.** The `app_*` tools work while the window is visible,
  and reach the menu bar through `app_menu`. Ask for full-screen control once,
  when something needs it, and keep it for the session. Release it at the
  end. Things that need it:
  - right-click menus such as a slide's Themes menu;
  - the launch sheet;
  - a window that Stage Manager shows only as a thumbnail.
- **The launch sheet.** On an installation that is not activated,
  "Activate ProPresenter" appears at every launch. "Skip for Now" dismisses it
  and signs into nothing.
- **Several monitors.** Full-screen screenshots and clicks go to one monitor,
  which may not be ProPresenter's. The screenshot result names the monitor it
  captured and lists the others. Run `switch_display` once at the start to
  move to ProPresenter's.
- **Stage Manager's strip (macOS).** It catches clicks near the screen's left
  edge.
  If clicks there do nothing, move the window away from the edge.
- **Library rows.** Clicking a row's name can start a rename. Click the row's
  icon instead, and press Escape if a text cursor appears.
- **The library filter.** It only takes typing when it already has focus.
- **A locked screen.** A full-screen approval times out. Ask the user to
  unlock it rather than retrying.
- **A step that will not drive.** Ask the user to do just that step, and to
  say when it is done. Then confirm from the file's modification time that
  ProPresenter saved before you read it.

## 8. Restore and record

1. Quit ProPresenter.
2. Restore everything that differs from the backup, including
   `Libraries/LibraryData`, ProPresenter's own index.
3. Move your test copies to `~/.Trash`, unless the user wants them kept for
   the next version.
4. Relaunch, and confirm `diff -rq` against the backup is clean.

Add an entry to
[docs/propresenter-versions.md](../../../docs/propresenter-versions.md) under
the version's heading, adding the heading if it is new: the date, what was
checked, and what turned up. Fix any parser bugs you found with tests that
follow AGENTS.md.

## Keep this skill current

Improve this file as part of the run whenever it was wrong, incomplete or
slower than it needed to be. In particular:

- **ProPresenter behaving differently by version.** A new prompt, a moved
  menu, a different save behaviour, a new data-folder layout. Name the
  version it applies to, so an older run is not misled.
- **New core functionality.** Anything that writes or builds a file needs a
  round-trip in step 6, and anything that reads one needs a comparison in
  step 5.
- **Lessons from driving the app.** Anything that cost time to work out, and
  whether it is specific to macOS or Windows.

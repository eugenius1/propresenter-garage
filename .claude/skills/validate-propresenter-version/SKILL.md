---
name: validate-propresenter-version
description: Check the core library against a specific ProPresenter release by opening real files in the app itself. Use when asked to validate, verify or test against a new (or older) ProPresenter version, to run the round-trip checks in ProPresenter, or to compare what ProPresenter shows with what the parser reports.
---

# Validating the core against a ProPresenter version

The test suite proves a file survives decoding and re-encoding. It cannot
prove that ProPresenter shows what the parser says it shows, or that
ProPresenter accepts what the core writes. This check covers both, by opening
real files in the app. The first run, against 20.0.1, found two parser bugs
the suite had passed for months. Its findings are in the table in
[CONTRIBUTING.md](../../../CONTRIBUTING.md#checked-against-propresenter).

Read AGENTS.md first. Its rules about real libraries apply throughout, and
everything below assumes them.

## 1. Agree the scope with the user

Ask which version, and which machine's data. Then confirm:

- **The apps you may control.** Normally ProPresenter only. Use computer use
  with nothing else granted.
- **What must not change.** Typically a sample library and a sample playlist.
  Never modify those, not even to test.
- **Whether you may delete anything.** For example, a few media-bin entries
  to test an export. Get the number agreed.

## 2. Get the right build

Renewed Vision keeps every macOS build online at
`https://renewedvision.com/downloads/propresenter/mac/ProPresenter_<version>_<build>.zip`.
Build numbers are in the history of the Homebrew cask:

```bash
for s in $(gh api "repos/Homebrew/homebrew-cask/commits?path=Casks/p/propresenter.rb&per_page=100" --jq '.[].sha'); do
  gh api "repos/Homebrew/homebrew-cask/contents/Casks/p/propresenter.rb?ref=$s" --jq .content | base64 -d | grep -E 'version "'
done | sed 's/^ *//' | sort -u -V
```

Every ProPresenter version shares one bundle identifier, so two installs on
one account share settings and the data folder. To keep a second version
alongside the user's, give it a separate macOS user account with its own copy
of the data. Never point an older version at data a newer one has saved.

Read the release notes (renewedvision.com/propresenter/release-notes) for
anything touching files, the library, playlists, the media bin, themes,
arrangements or workspaces. Report those to the user before you start.

## 3. Back up before anything else

The data folder is `applicationShowDirectory` in
`defaults read com.renewedvision.propresenter`, normally
`~/Documents/ProPresenter`. Copy everything except `Media` into your
scratchpad:

```bash
B=<scratchpad>/pp-backup
cd ~/Documents/ProPresenter && cp -Rp Libraries Playlists Themes Configuration Presets "$B"/
for d in Libraries Playlists Themes Configuration Presets; do diff -rq "$d" "$B/$d"; done
```

Media is gigabytes and nothing here touches it. Check the copy before going
on, and tell the user where it is.

## 4. Run the suite against the installation

```bash
PP_LIBRARY_DIR=~/Documents/ProPresenter/Libraries \
PP_MEDIA_FILE=~/Documents/ProPresenter/Playlists/Media npm test
```

A test that fails here but passes in CI is a finding, not noise. It can also
be a test that assumes something about real data. Find out which before
changing anything.

## 5. Read what ProPresenter shows

Compare the parser with the app on a few files. Choose songs with sections,
a title slide, macros and accented text. The MCP server's `read_presentation`
and `read_media_bin` give the parser's view. A short `npx tsx` script against
`packages/core/src/lib` works just as well.

- **Slide numbers.** Do they match `slidesInOrder()`? ProPresenter numbers
  slides in group order, not in the order they are stored.
- **Text and groups.** Are each slide's text and group names as shown? Use
  the slide grid's text view to read them at full size.
- **Media kinds.** Are the media bin's videos, images and audio counted the
  way ProPresenter shows them?
- **Playlists.** Does each playlist open with every entry found?

## 6. Round-trip what the core writes

Each of these goes into the installation as a **new file** with its own
document uuid and name, such as `Song (Garage style).pro`. Never write over an
existing `.pro`. Open each one in ProPresenter and check it.

- **Fixer.** Run `planFixes`/`applyFixes` on a copy. The lines should read as
  promised, and the slide numbers in the plan should match the app's.
- **Restyle.** Run `applyStyle` with a theme from `themeStyles()` and with
  another song's slide from `presentationStyle()`. The title slide and macros
  should be unchanged.
- **Media Bin export.** Remove the agreed entry with `applyOperations`. The
  bin should open without it.
- **Playlist.** Build one with `presentationEntry`, `headerEntry` and
  `mediaEntry`, then reorder it, insert into it and rename it. It should open
  with every entry found, and every other playlist should be unchanged.

To check a core feature against ProPresenter's own, make two copies of the
same file:

1. Do the operation in ProPresenter on one copy, e.g. right-click → Themes on
   the lyric slides.
2. Do it with the core on the other.
3. Decode both and diff them slide by slide, field by field:
   - the elements, their uuids and `info`;
   - the text attributes and the RTF;
   - everything outside `base_slide`.
4. Run the fidelity gate on ProPresenter's copy as well. A `lossy` verdict
   there means ProPresenter wrote a field the schema lacks.

ProPresenter keeps `Playlists/Library` and `Playlists/Media` in memory and
writes them when it quits. To replace either one:

1. Quit ProPresenter and confirm the quit dialog.
2. Check the file still matches the backup.
3. Copy yours in.
4. Relaunch.
5. After the relaunch, check ProPresenter did not rewrite it.

## 7. Driving ProPresenter

- **Background control first.** The `app_*` tools work while the window is
  visible, and they reach the menu bar through `app_menu`. Under Stage
  Manager, a window that is not in front captures as a thumbnail. Ask for
  full-screen control then, and release it when done.
- **Right-click menus need full-screen control.** The Themes menu on a slide
  is one, and background control cannot open it.
- **Several monitors.** Full-screen screenshots and clicks go to one monitor,
  which may not be ProPresenter's. The screenshot result names the monitor it
  captured and lists the others. Use `switch_display` to move to
  ProPresenter's monitor before clicking. Otherwise the clicks land on another
  screen's menu bar or desktop.
- **Stage Manager's strip.** It catches clicks near the screen's left edge. If
  clicks there do nothing, move ProPresenter's window away from the edge.
- **The launch prompt.** An "Activate ProPresenter" sheet appears at every
  launch. "Skip for Now" dismisses it and signs into nothing. It needs
  full-screen control.
- **Library rows.** Clicking a row's name can start a rename. Click the row's
  icon instead, and press Escape if a text cursor appears.
- **The library filter.** It only takes typing when it already has focus.
- **Slides.** Clicking a slide in Show mode sends it to the output. Switch to
  Edit mode before selecting slides, and never trigger one.
- **Locked screen.** If the Mac is locked, a full-screen approval times out.
  Stop and ask the user to unlock it rather than retrying.
- **When a step will not drive.** If one UI step keeps failing, ask the user to
  do just that step, and to say when it is done. Then confirm from the file's
  modification time that ProPresenter saved before you read it. The check
  depends on the file, not on who clicked.

## 8. Restore and record

1. Quit ProPresenter.
2. Restore everything that differs from the backup, including
   `Libraries/LibraryData`, ProPresenter's own index.
3. Move your test copies to `~/.Trash`.
4. Relaunch, and confirm `diff -rq` against the backup is clean.

Unless the user wants the test files kept, for example to check them again in
the next version.

Add a row to the table in CONTRIBUTING.md: the version, the date, what was
checked, and what turned up. Fix any parser bugs you found with tests, using
synthetic fixtures and real files only through the environment variables.

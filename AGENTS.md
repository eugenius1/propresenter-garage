<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Eusebius Ngemera -->

# Notes for coding agents

Deliberately short: this file is loaded into context on every session, so it
carries only attribution, and the rules whose cost is unrecoverable if missed.
Anything a test already enforces is left to [CONTRIBUTING.md](CONTRIBUTING.md)
— a failing suite catches those, nothing catches a destroyed library. Read
CONTRIBUTING.md before changing code: conventions, architecture, and the traps
that have cost real debugging time are all there.

An installable browser app for ProPresenter 7 files. Vite, React, TypeScript,
vitest. No server, no backend, nothing uploaded.

## Before every commit

```bash
npm run check
```

Codegen, lint, both typechecks, and the full suite. It is the same gate CI
runs, and it includes the codegen step, so it also catches the case where a
clean checkout would fail to build.

## Attribution

End every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Use the model that actually did the work. Commit messages themselves are prose
explaining the reasoning and what went wrong — not a changelog line.

## Never commit somebody's ProPresenter library

Real `.pro` files, media-bin playlists and media folders are personal data and
stay out of the repository. `public/__dev-*` is gitignored for exactly this;
put development copies there and nowhere else. If you add fixtures for a manual
check, delete them before committing.

Tests that need real files read them from `PP_MEDIA_FILE` and `PP_LIBRARY_DIR`
and skip cleanly when absent, so CI stays green without them.

## Never write over an original ProPresenter file unguarded

Writing back over the file ProPresenter owns is how a library gets destroyed.
The Media Bin tool never does it at all: its exports are a differently named
copy the user moves into place themselves — see `exportFilename()` in
`src/lib/operations.ts`.

The presentation fixer is the one path that does write in place, and it is
allowed to only because all four of these hold. Do not add a fifth write path
that keeps fewer of them, and do not quietly drop one from this one:

1. **The fidelity gate passes on that file**, checked as the file is written
   rather than inferred from the corpus. The schema is reverse-engineered and
   protobuf.js silently drops fields it does not declare. See *The export
   safety gate* in CONTRIBUTING.md.
2. **The user has downloaded a backup** of exactly the files about to change.
   The button that writes is disabled until they have, and goes back to being
   disabled if the selection grows past what the backup covers.
3. **Every line was shown and ticked.** The user sees the line as it is and as
   it would read before anything happens, and the fix run touches only what is
   still ticked.
4. **The result is read back and compared** to what was promised, for every
   line of every box including the ones no fix touched. A file that comes back
   saying anything else is not written.

`applyFixes()` in `src/lib/fixes.ts` enforces 1 and 4 and cannot be bypassed;
2 and 3 live in `src/tools/Presentations.tsx`.

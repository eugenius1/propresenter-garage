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

The gate CI runs; what it covers is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Before every push

Unless the change is trivial, strongly recommended: run `/code-review --fix`
(or an equivalent review-and-fix pass) over the branch's changes, using Claude
Sonnet or a model of similar strength, then commit its fixes and re-run the
pre-commit check above. It catches bugs, duplication, dead code and needless
complexity that the checks don't.

## Attribution

End every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Use the model that actually did the work. Commit messages themselves are prose
explaining the reasoning and what went wrong — not a changelog line.

## Never commit somebody's ProPresenter library

Real `.pro` files, media-bin playlists and media folders are personal data and
stay out of the repository. Where development copies go instead, and how
tests reach real files, is under *Conventions* and *Testing against real
files* in [CONTRIBUTING.md](CONTRIBUTING.md).

## Never write over an original ProPresenter file unguarded

Writing back over the file ProPresenter owns is how a library gets destroyed.
The Media Bin tool never does it at all: its exports are a differently named
copy the user moves into place themselves — see `exportFilename()` in
`packages/core/src/lib/operations.ts`.

Presentation text is written in place, and only through `applyFixes()` in
`packages/core/src/lib/fixes.ts`. Every surface that writes must keep all four
of these guards. Each is defined by what it protects, so a new surface keeps
it in its own form; do not add a write path that keeps fewer, and do not
quietly drop one from a path that has them:

1. **The fidelity gate passes on that file**, checked as the file is written
   rather than inferred from the corpus. The schema is reverse-engineered and
   protobuf.js silently drops fields it does not declare. See *The export
   safety gate* in CONTRIBUTING.md.
2. **A backup of exactly the files about to change exists before any of them
   changes**, and the run stops if it cannot be made.
3. **A person saw every line and chose it.** They see each line as it is and
   as it would read before anything happens, and the run touches only what
   they left chosen. The model never answers for them.
4. **The result is read back and compared** to what was promised, for every
   line of every box including the ones no change touched. A file that comes
   back saying anything else is not written.

| Guard | Web app (`apps/web/src/tools/Presentations.tsx`) | MCP server (`packages/mcp/src/edits.ts`) |
| --- | --- | --- |
| 1, 4 | `applyFixes()` | `applyFixes()`, run again on the file as read at apply time |
| 2 | The write button stays disabled until the user downloads a backup zip covering the selection | `replaceWithBackup()` in `packages/node/src/write.ts` copies every file out of the library, reads each copy back, and writes nothing if one fails |
| 3 | Every line shown with a tick box | `apply_slide_edits` takes only a plan id, and the server asks the person through MCP elicitation, one tick box per line; a client that cannot ask gets nothing written |

A command line, when there is one, uses `packages/node` for 2 and must get 3
from a person at a terminal, or from a plan file a person reviewed — never
from a flag a script can pass on its own.

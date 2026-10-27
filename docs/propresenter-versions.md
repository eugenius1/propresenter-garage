# ProPresenter versions checked

What each ProPresenter version was checked for, and what turned up. The
procedure is the
[`validate-propresenter-version`](../.agents/skills/validate-propresenter-version/SKILL.md)
skill. Each run adds its own entry here, under the version it checked, newest
version first.

## 21.4.2

**2026-09-11.** Export safety gate over a real library; not opened in the app.

- Every file `identical`.

## 20.0.1 (macOS)

**2026-10-27.** `applyStyle` compared with ProPresenter's own Themes menu,
field by field, on one song (#36).

- The box holding the words keeps the slide's element uuid. `applyStyle`
  had given it a fresh one.
- A theme's alignment guides go to `template_guidelines`, not to the slide's
  own guides.
- The words carry an `original_font` range for the theme box's font.
- All three now match.

**2026-10-24.** The full procedure: the suite against an installation, then
slide numbering and text, media-bin kinds, a fixer run, three restyles, a
Media Bin export and a built playlist, each opened in the app (#23).

- Slides were numbered in storage order, not the group order ProPresenter
  shows. Fixed.
- Every media-bin action was typed as audio, while the media elements said
  video or image. Fixed: the element now decides.
- Every file `identical`.

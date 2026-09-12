// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast of the palette, measured rather than assumed.
 *
 * Every colour used to be hand-picked and none of it was ever checked. Reading
 * the Radix scales straight from the package and asserting the pairings the
 * stylesheet actually uses means a future change to a token cannot quietly drop
 * something below the threshold.
 *
 * Thresholds are WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text (18.66px
 * bold or 24px regular) and for non-text things like focus rings.
 */

const COLOURS = "node_modules/@radix-ui/colors";

function scale(name: string, dark: boolean): Record<string, string> {
  const file = path.join(COLOURS, `${name}${dark ? "-dark" : ""}.css`);
  const css = fs.readFileSync(file, "utf8");
  return Object.fromEntries(
    [...css.matchAll(/--[a-z]+-(\d+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const HUES = [
  ["added", "green"],
  ["removed", "red"],
  ["moved", "violet"],
  ["renamed", "amber"],
  ["retimed", "cyan"],
  ["relinked", "pink"],
  ["restyled", "iris"],
] as const;

/** The pairings the stylesheet makes, per mode. */
function pairings(dark: boolean) {
  const slate = scale("slate", dark);
  const accent = scale("indigo", dark);
  const surface = slate["1"];
  const inset = slate["3"];

  const rows: { label: string; fg: string; bg: string; need: number }[] = [
    { label: "body text on a card", fg: slate["12"], bg: surface, need: 4.5 },
    { label: "secondary text on a card", fg: slate["11"], bg: surface, need: 4.5 },
    { label: "secondary text on an inset", fg: slate["11"], bg: inset, need: 4.5 },
    { label: "links and the active tab", fg: accent["11"], bg: surface, need: 4.5 },
    // Step 9 is the same hex in light and dark, so the solid button is one
    // colour with white on it in both.
    { label: "button label on the solid accent", fg: "#ffffff", bg: accent["9"], need: 4.5 },
    // Non-text: focus rings, the app mark, a checkbox tint.
    { label: "focus ring and app mark", fg: accent["9"], bg: surface, need: 3 },
  ];

  for (const [role, hue] of HUES) {
    const s = scale(hue, dark);
    rows.push({ label: `${role} tag text`, fg: s["12"], bg: s["3"], need: 4.5 });
    // Stat numbers are 19px at weight 650, which WCAG counts as large text.
    rows.push({ label: `${role} stat number`, fg: s["11"], bg: surface, need: 3 });
  }

  return rows;
}

describe.each([
  ["light", false],
  ["dark", true],
])("palette contrast in %s mode", (_mode, dark) => {
  for (const { label, fg, bg, need } of pairings(dark as boolean)) {
    it(`${label} meets ${need}:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(need);
    });
  }
});

describe("the reasoning behind the accent choices", () => {
  it("records why indigo was chosen over blue", () => {
    // Blue was tried first and forced a per-mode workaround for the button.
    for (const dark of [false, true]) {
      expect(contrast("#ffffff", scale("blue", dark)["9"])).toBeLessThan(4.5);
      expect(contrast("#ffffff", scale("indigo", dark)["9"])).toBeGreaterThan(4.5);
    }
  });

  it("confirms the accent is one colour in both modes", () => {
    expect(scale("indigo", false)["9"]).toBe(scale("indigo", true)["9"]);
  });

  it("confirms the dark scales climb lighter, so dark cannot reuse light's step", () => {
    const light = scale("indigo", false);
    const dark = scale("indigo", true);
    expect(luminance(light["11"])).toBeLessThan(luminance(light["9"]));
    expect(luminance(dark["11"])).toBeGreaterThan(luminance(dark["9"]));
  });

  it("confirms tag text needed step 12, not step 11", () => {
    // Step 11 on step 3 lands at 4.2-4.6 in light: too close to the line for
    // 10.5px bold type.
    const amber = scale("amber", false);
    expect(contrast(amber["11"], amber["3"])).toBeLessThan(4.5);
    expect(contrast(amber["12"], amber["3"])).toBeGreaterThan(9);
  });
});

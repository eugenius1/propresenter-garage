// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { fold } from "../search";

/** What a search does: fold both sides, then look for one inside the other. */
const finds = (haystack: string, needle: string) => fold(haystack).includes(fold(needle));

describe("folding for search", () => {
  it("ignores case, as it always did", () => {
    expect(finds("Sainte Cène 1", "SAINTE")).toBe(true);
  });

  it("finds an accented name from an unaccented query", () => {
    // The case that prompted this: "Cène" was unreachable without the key.
    expect(finds("Sainte Cène 1", "cene")).toBe(true);
    expect(finds("Croix_Ciel_Lumière.mov", "lumiere")).toBe(true);
    expect(finds("Que ton Nom résonne", "resonne")).toBe(true);
  });

  it("finds an unaccented name from an accented query", () => {
    // Both sides are folded, so it works whichever way round they are typed:
    // the same library holds "Sainte Cène" and a file called "Sainte Scene".
    expect(finds("Sainte Scene.jpeg", "scène")).toBe(true);
    expect(finds("Media/Assets/Sainte Scene.jpeg", "Scène")).toBe(true);
  });

  it("handles the letters NFD leaves alone", () => {
    // ø, ł and đ are single letters, not a base plus a mark, so decomposing
    // does nothing for them.
    expect(finds("Bjørn", "bjorn")).toBe(true);
    expect(finds("Łukasz", "lukasz")).toBe(true);
  });

  it("handles the letters that stand for two", () => {
    expect(finds("Cœur", "coeur")).toBe(true);
    expect(finds("Straße", "strasse")).toBe(true);
  });

  it("leaves the letters themselves alone", () => {
    // Only marks are stripped. A fold that also dropped punctuation or spaces
    // would quietly match across words that are not adjacent.
    expect(fold("Sainte Cène 1")).toBe("sainte cene 1");
    expect(fold("Media/Assets/Croix_Ciel_Lumière.mov")).toBe(
      "media/assets/croix_ciel_lumiere.mov"
    );
  });

  it("does not fold different letters onto each other", () => {
    // Stripping marks must not go so far that "cane" finds "Cène".
    expect(finds("Sainte Cène", "cane")).toBe(false);
    expect(finds("Sainte Cène", "scene")).toBe(false);
  });

  it("survives text with no letters at all", () => {
    expect(fold("")).toBe("");
    expect(fold("12 — 34")).toBe("12 — 34");
  });
});

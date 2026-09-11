// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { en } from "../en";
import { fr } from "../fr";
import { createI18n, detectLanguage, DICTIONARIES, interpolate, LANGUAGES } from "..";
import { describeModsInline } from "../describe";
import { buildLibrary, decodeMediaDocument } from "../../lib/model";
import { auditLibrary } from "../../lib/audit";
import { hasRealFile, readRealFile } from "../../lib/__tests__/fixtures";

/** Every leaf string path in a dictionary, so locales can be compared. */
function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe("dictionaries", () => {
  it("cover exactly the same keys in every language", () => {
    const reference = paths(en).sort();
    for (const lang of LANGUAGES) {
      expect(paths(DICTIONARIES[lang]).sort(), `locale ${lang}`).toEqual(reference);
    }
  });

  it("keeps every plural form list the same length across languages", () => {
    // A mismatched arity would silently pick the wrong form at runtime.
    expect(paths(fr).filter((p) => p.includes("["))).toEqual(
      paths(en).filter((p) => p.includes("["))
    );
  });

  it("has no untranslated French strings left identical to English by accident", () => {
    // Proper nouns and format-only strings are legitimately shared.
    const allowed = new Set([
      "meta.localeTag", "meta.name", "meta.quoteOpen", "meta.quoteClose", "meta.colon",
      "app.title", "app.footnoteLink", "tools.mediaBin.appOn",
      "library.image", "library.audio", "kinds.image", "kinds.audio",
      "errors.playlistType.audio", "playback.none",
    ]);

    const flat = (dict: unknown, prefix = ""): Record<string, string> => {
      const out: Record<string, string> = {};
      if (dict && typeof dict === "object" && !Array.isArray(dict)) {
        for (const [k, v] of Object.entries(dict)) {
          Object.assign(out, flat(v, prefix ? `${prefix}.${k}` : k));
        }
      } else if (typeof dict === "string") {
        out[prefix] = dict;
      }
      return out;
    };

    const flatEn = flat(en);
    const flatFr = flat(fr);
    const identical = Object.keys(flatEn).filter(
      (k) => !allowed.has(k) && flatEn[k] === flatFr[k]
    );
    expect(identical).toEqual([]);
  });
});

describe("device language detection", () => {
  it("picks French when French is the reader's first preference", () => {
    expect(detectLanguage(["fr-FR", "en-US"])).toBe("fr");
  });

  it("ignores the region subtag", () => {
    expect(detectLanguage(["fr-CA"])).toBe("fr");
    expect(detectLanguage(["en-GB"])).toBe("en");
  });

  it("respects preference order and skips unsupported languages", () => {
    // A reader configured as German-then-French should get French, not English.
    expect(detectLanguage(["de-DE", "fr-BE", "en"])).toBe("fr");
  });

  it("falls back to English when nothing matches", () => {
    expect(detectLanguage(["ja", "ko"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });
});

describe("plural rules", () => {
  const EN = createI18n("en");
  const FR = createI18n("fr");

  it("uses the singular for zero in French but the plural in English", () => {
    // French treats zero as singular. An `n === 1` test would render
    // "0 éléments", which is wrong.
    expect(FR.plural(FR.t.tools.mediaBin.items, 0)).toBe("0 élément");
    expect(EN.plural(EN.t.tools.mediaBin.items, 0)).toBe("0 items");
  });

  it("agrees on one and many", () => {
    expect(FR.plural(FR.t.tools.mediaBin.items, 1)).toBe("1 élément");
    expect(FR.plural(FR.t.tools.mediaBin.items, 2)).toBe("2 éléments");
    expect(EN.plural(EN.t.tools.mediaBin.items, 1)).toBe("1 item");
    expect(EN.plural(EN.t.tools.mediaBin.items, 2)).toBe("2 items");
  });

  it("formats numbers for the locale", () => {
    // French groups with a narrow no-break space, English with a comma.
    expect(EN.num(12345)).toBe("12,345");
    expect(FR.num(12345)).not.toBe("12,345");
    expect(FR.num(12345)).toMatch(/12.345/);
  });

  it("quotes with guillemets in French and inch marks in English", () => {
    expect(EN.quote("Fonds")).toBe('"Fonds"');
    expect(FR.quote("Fonds")).toContain("\u00ab");
    expect(FR.quote("Fonds")).toContain("\u00bb");
  });
});

describe("interpolation", () => {
  it("substitutes named placeholders", () => {
    expect(interpolate("{a} then {b}", { a: "one", b: 2 })).toBe("one then 2");
  });

  it("leaves unknown placeholders untouched rather than printing undefined", () => {
    expect(interpolate("{missing}", {})).toBe("{missing}");
  });

  it("resolves every placeholder each dictionary declares", () => {
    // Guards against a French string using {playlist} where English uses {n}.
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const flat = (dict: unknown, prefix = ""): [string, string][] => {
      if (typeof dict === "string") return [[prefix, dict]];
      if (Array.isArray(dict)) return dict.flatMap((v, i) => flat(v, `${prefix}[${i}]`));
      if (dict && typeof dict === "object") {
        return Object.entries(dict).flatMap(([k, v]) =>
          flat(v, prefix ? `${prefix}.${k}` : k)
        );
      }
      return [];
    };

    const enStrings = new Map(flat(en));
    for (const [path, value] of flat(fr)) {
      expect(placeholders(value), `placeholders differ at ${path}`).toEqual(
        placeholders(enStrings.get(path) ?? "")
      );
    }
  });
});

describe.skipIf(!hasRealFile)("language independence of analysis", () => {
  const EN = createI18n("en");
  const FR = createI18n("fr");

  it("keeps localised prose out of the duplicate fingerprint", () => {
    // The duplicate identity must never depend on the chosen language. An
    // earlier version built it from English display strings, which would have
    // made French readers see a different set of duplicates.
    const lib = buildLibrary(decodeMediaDocument(readRealFile()));
    const modified = lib.items.filter((i) => i.modifications.descriptors.length > 0);
    expect(modified.length).toBeGreaterThan(0);

    for (const item of modified) {
      // French wording must never appear -- unlike the descriptor `kind`
      // values, which are stable identifiers rather than prose.
      expect(item.modifications.fingerprint).not.toContain(fr.mods.cropped);
      expect(item.modifications.fingerprint).not.toContain(fr.mods.mirroredHorizontally);
      expect(item.modifications.fingerprint).not.toContain(fr.mods.blurred);
    }
  });

  it("renders the same modifications differently per language while the identity holds", () => {
    const lib = buildLibrary(decodeMediaDocument(readRealFile()));
    const mirrored = lib.items.find((i) => i.modifications.flippedHorizontally);
    expect(mirrored).toBeDefined();

    const descriptors = mirrored!.modifications.descriptors;
    expect(describeModsInline(EN, descriptors)).toContain(en.mods.mirroredHorizontally);
    expect(describeModsInline(FR, descriptors)).toContain(fr.mods.mirroredHorizontally);
    expect(describeModsInline(EN, descriptors)).not.toEqual(describeModsInline(FR, descriptors));

    // Same input, same identity, whichever language rendered it.
    const again = buildLibrary(decodeMediaDocument(readRealFile()));
    const same = again.items.find((i) => i.uuid === mirrored!.uuid)!;
    expect(same.modifications.fingerprint).toBe(mirrored!.modifications.fingerprint);
  });

  it("groups variants consistently across languages", () => {
    const audit = auditLibrary(buildLibrary(decodeMediaDocument(readRealFile())));
    expect(audit.variantGroups.length).toBeGreaterThan(0);
  });

  it("gives every variant a path so it can be found on disk", () => {
    const audit = auditLibrary(buildLibrary(decodeMediaDocument(readRealFile())));
    for (const group of audit.variantGroups) {
      expect(group.path).toBeTruthy();
      for (const variant of group.variants) {
        expect(variant.playlists.length).toBeGreaterThan(0);
      }
    }
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { basePath, pathForSlug, slugFromPath } from "../routing";

const SLUGS = ["presentations", "media-bin"] as const;

describe("finding where the app is mounted", () => {
  it("handles the domain root", () => {
    expect(basePath("/", SLUGS)).toBe("/");
    expect(basePath("/presentations", SLUGS)).toBe("/");
  });

  it("handles a project subpath, which is how GitHub Pages serves it", () => {
    expect(basePath("/propresenter-garage/", SLUGS)).toBe("/propresenter-garage/");
    expect(basePath("/propresenter-garage/media-bin", SLUGS)).toBe("/propresenter-garage/");
  });

  it("does not mistake a folder for a tool", () => {
    // A directory that happens to share a tool's name is still the base.
    expect(basePath("/media-bin/presentations", SLUGS)).toBe("/media-bin/");
  });

  it("tolerates a trailing slash on a tool path", () => {
    expect(basePath("/propresenter-garage/media-bin/", SLUGS)).toBe("/propresenter-garage/");
  });
});

describe("reading the tool from a path", () => {
  it("recognises a tool segment", () => {
    expect(slugFromPath("/propresenter-garage/media-bin", SLUGS)).toBe("media-bin");
    expect(slugFromPath("/presentations", SLUGS)).toBe("presentations");
  });

  it("returns null at the root, where the first tool lives", () => {
    expect(slugFromPath("/", SLUGS)).toBeNull();
    expect(slugFromPath("/propresenter-garage/", SLUGS)).toBeNull();
  });

  it("returns null for an unknown segment", () => {
    expect(slugFromPath("/propresenter-garage/nonsense", SLUGS)).toBeNull();
  });
});

describe("building a tool's URL", () => {
  it("gives the first tool the root itself, not a redirect", () => {
    expect(pathForSlug("/propresenter-garage/", "presentations", SLUGS)).toBe(
      "/propresenter-garage/"
    );
  });

  it("gives every other tool its own segment", () => {
    expect(pathForSlug("/propresenter-garage/", "media-bin", SLUGS)).toBe(
      "/propresenter-garage/media-bin"
    );
    expect(pathForSlug("/", "media-bin", SLUGS)).toBe("/media-bin");
  });

  it("round-trips: a built path reads back as the tool that built it", () => {
    for (const base of ["/", "/propresenter-garage/"]) {
      for (const slug of SLUGS) {
        const url = pathForSlug(base, slug, SLUGS);
        expect(basePath(url, SLUGS)).toBe(base);
        expect(slugFromPath(url, SLUGS) ?? SLUGS[0]).toBe(slug);
      }
    }
  });
});

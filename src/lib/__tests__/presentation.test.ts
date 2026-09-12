// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkPresentationFile,
  decodePresentation,
  encodePresentation,
  readPresentation,
} from "../presentation";
import { syntheticTextPresentation } from "./synthetic";

const report = () => checkPresentationFile("Checked Song.pro", syntheticTextPresentation());
const issuesOf = (kind: string) => report().issues.filter((i) => i.kind === kind);

describe("reading a presentation", () => {
  it("walks cues into text boxes and names their section", () => {
    const doc = readPresentation(decodePresentation(syntheticTextPresentation()));
    expect(doc.name).toBe("Checked Song");
    expect(doc.slideCount).toBe(6);
    expect(doc.textBoxes).toHaveLength(6);
    expect(doc.textBoxes[0].groupName).toBe("Verse");
    expect(doc.textBoxes[3].groupName).toBe("Chorus");
  });

  it("re-encodes to byte-identical output", () => {
    // The same gate the playlist tools use: if the schema did not cover these
    // files completely, writing a fix back would drop whatever it misses.
    const bytes = syntheticTextPresentation();
    const again = encodePresentation(decodePresentation(bytes));
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(again))).toBe(0);
  });

  it("reports a decode failure rather than throwing", () => {
    const result = checkPresentationFile("broken.pro", new Uint8Array([0x3c, 0xff, 0xfe]));
    expect(result.error).toBeTruthy();
    expect(result.issues).toEqual([]);
  });
});

describe("line-level whitespace", () => {
  it("finds a leading space on a line that is not the first", () => {
    // Box-level checking would miss this entirely: the box starts "Fine here".
    const found = issuesOf("leadingSpace");
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(" leading space");
    expect(found[0].lineIndex).toBe(1);
    expect(found[0].cueName).toBe("Leading");
  });

  it("finds a trailing space on a line that is not the last", () => {
    const found = issuesOf("trailingSpace");
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("trailing space ");
    expect(found[0].lineIndex).toBe(0);
  });

  it("finds a doubled space inside a line", () => {
    const found = issuesOf("repeatedSpace");
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("two  spaces here");
  });

  it("says nothing about a tidy slide", () => {
    expect(report().issues.some((i) => i.cueName === "Clean")).toBe(false);
  });

  it("names the slide and section for every issue", () => {
    for (const issue of report().issues) {
      expect(issue.slideIndex).toBeGreaterThanOrEqual(0);
      expect(issue.cueName).toBeTruthy();
      expect(issue.groupName).toBeTruthy();
    }
  });
});

describe("blank lines", () => {
  it("reports a blank line sitting between two lines of text", () => {
    const found = issuesOf("blankLine");
    expect(found).toHaveLength(1);
    expect(found[0].cueName).toBe("Gap");
    expect(found[0].lineIndex).toBe(1);
  });

  it("counts an entirely empty text box instead of reporting it", () => {
    // Real presentations are full of empty placeholder boxes -- three actual
    // files carried ten between them. Reporting each as a problem would bury
    // the handful of findings that matter.
    const result = report();
    expect(result.emptyTextBoxes).toBe(1);
    expect(result.issues.some((i) => i.cueName === "Empty")).toBe(false);
  });
});

/**
 * A folder of real presentations, when one is present.
 *
 * Points at a development copy of an installation, not an install location.
 */
const REAL_LIBRARY =
  process.env.PP_LIBRARY_DIR ?? path.join(os.homedir(), "dev/me/ProPresenter/Libraries");
const hasRealLibrary = fs.existsSync(REAL_LIBRARY);

describe.skipIf(!hasRealLibrary)("against real presentations", () => {
  // Listed in beforeAll, not here: vitest runs a describe body during
  // collection even for a suite skipIf will skip, so reading the directory
  // here throws on any machine without one.
  let files: string[] = [];
  beforeAll(() => {
    if (!hasRealLibrary) return;
    files = fs.readdirSync(REAL_LIBRARY).filter((f) => f.toLowerCase().endsWith(".pro"));
  });

  it("decodes every file in the library", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const result = checkPresentationFile(
        name,
        new Uint8Array(fs.readFileSync(path.join(REAL_LIBRARY, name)))
      );
      expect(result.error, name).toBeUndefined();
      expect(result.slideCount).toBeGreaterThan(0);
    }
  });

  it("re-encodes every file byte for byte", () => {
    for (const name of files) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(REAL_LIBRARY, name)));
      const again = encodePresentation(decodePresentation(bytes));
      expect(Buffer.compare(Buffer.from(bytes), Buffer.from(again)), name).toBe(0);
    }
  });

  it("does not report a leading space on every line", () => {
    // The failure mode a naive reader falls into: RTF terminates a control
    // word with a space, so matching on spaces flags nearly every line.
    let lines = 0;
    let leading = 0;
    for (const name of files) {
      const doc = readPresentation(
        decodePresentation(new Uint8Array(fs.readFileSync(path.join(REAL_LIBRARY, name))))
      );
      for (const box of doc.textBoxes) {
        for (const line of box.lines) {
          if (line.text.trim() === "") continue;
          lines++;
          if (/^[ \t]/.test(line.text)) leading++;
        }
      }
    }
    expect(lines).toBeGreaterThan(20);
    expect(leading / lines).toBeLessThan(0.25);
  });
});

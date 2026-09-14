// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it } from "vitest";
import {
  checkPresentation,
  checkPresentationFile,
  decodePresentation,
  encodePresentation,
  readPresentation,
  type PresentationDoc,
} from "../presentation";
import { extractLines } from "../rtf";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

const report = () => checkPresentationFile("Checked Song.pro", syntheticTextPresentation());

/**
 * One text box holding the given lines.
 *
 * Built by writing RTF and reading it back rather than by listing lines, so
 * the fixture carries real source offsets and cannot drift from what the
 * reader actually produces.
 */
function boxOf(...texts: string[]): PresentationDoc {
  const body = texts.map((text) => `\\cb3 ${text}`).join("\\par\\pard");
  const rtf = `{\\rtf0\\ansi\\uc1\\pard\\f0\\fs100${body}}`;
  return {
    name: "One",
    slideCount: 1,
    textBoxes: [
      {
        boxIndex: 0,
        slideIndex: 0,
        cueName: "1",
        groupName: "Verse",
        lines: extractLines(rtf),
        rtf,
      },
    ],
  };
}
const issuesOf = (kind: string) => report().issues.filter((i) => i.kind === kind);

describe("reading a presentation", () => {
  it("walks cues into text boxes and names their section", () => {
    const doc = readPresentation(decodePresentation(syntheticTextPresentation()));
    expect(doc.name).toBe("Checked Song");
    expect(doc.slideCount).toBe(7);
    expect(doc.textBoxes).toHaveLength(7);
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

describe("trailing commas", () => {
  it("finds a line that ends with a comma", () => {
    const found = issuesOf("trailingComma");
    expect(found).toHaveLength(2);
    expect(found[0].text).toBe("Que ton nom,");
    expect(found[0].cueName).toBe("Comma");
  });

  it("finds one with a space before the comma", () => {
    // The space does not change what the line ends with.
    expect(issuesOf("trailingComma")[1].text).toBe("pour toujours ,");
  });

  it("finds one with whitespace after the comma", () => {
    // Kept out of the shared fixture: a line ending "nom, " is also a trailing
    // space, and folding it in there would tangle the two counts together.
    const report = checkPresentation("One.pro", boxOf("Que ton nom, ", "sois glorifie"));
    expect(report.issues.filter((i) => i.kind === "trailingComma")).toHaveLength(1);
    expect(report.issues.filter((i) => i.kind === "trailingSpace")).toHaveLength(1);
  });

  it("says nothing about a comma inside a line", () => {
    // Only the end of the line matters; prose commas are not findings.
    const report = checkPresentation("One.pro", boxOf("Seigneur, mon Dieu et mon Roi"));
    expect(report.issues).toEqual([]);
  });

  it("leaves the other counts alone", () => {
    // The comma slide carries no whitespace problems, so switching the check
    // on cannot inflate the numbers the other checks report.
    expect(issuesOf("leadingSpace")).toHaveLength(1);
    expect(issuesOf("trailingSpace")).toHaveLength(1);
    expect(issuesOf("repeatedSpace")).toHaveLength(1);
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

describe.skipIf(!hasRealLibrary)("against real presentations", () => {
  // Listed in beforeAll, not here: vitest runs a describe body during
  // collection even for a suite skipIf will skip, so reading the directory
  // here throws on any machine without one.
  let files: string[] = [];
  beforeAll(() => {
    if (!hasRealLibrary) return;
    files = libraryFiles();
  });

  it("decodes every file in the library", () => {
    expect(files.length).toBeGreaterThan(0);
    let slides = 0;

    for (const name of files) {
      const result = checkPresentationFile(name, readLibraryFile(name));
      expect(result.error, name).toBeUndefined();
      slides += result.slideCount;
    }

    // Counted across the library rather than asserted per file: eight of the
    // 879 presentations in the library this was written against hold no cues
    // at all. Somebody made them and never filled them in, which is ordinary
    // and not something the reader should be told about.
    expect(slides).toBeGreaterThan(files.length);
  });

  it("re-encodes every file byte for byte", () => {
    for (const name of files) {
      const bytes = readLibraryFile(name);
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
      const doc = readPresentation(decodePresentation(readLibraryFile(name)));
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

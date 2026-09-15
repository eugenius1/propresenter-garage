// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it } from "vitest";
import { applyFixes, fixFiles, FixError, planFixes, type LineFix } from "../fixes";
import {
  checkPresentation,
  decodePresentation,
  readPresentation,
  type TextIssueKind,
} from "../presentation";
import { extractLines } from "../rtf";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

const ALL: TextIssueKind[] = [
  "leadingSpace",
  "trailingSpace",
  "blankLine",
  "repeatedSpace",
  "trailingComma",
  "trailingSemicolon",
  "trailingFullStop",
];

function plan(bytes: Uint8Array, kinds: TextIssueKind[] = ALL) {
  const doc = readPresentation(decodePresentation(bytes));
  const issues = checkPresentation("x.pro", doc).issues.filter((i) => kinds.includes(i.kind));
  return planFixes(doc, issues);
}

/** Read a file back the way the interface would, for checking what changed. */
function linesOf(bytes: Uint8Array): string[][] {
  return readPresentation(decodePresentation(bytes)).textBoxes.map((b) =>
    b.lines.map((l) => l.text)
  );
}


/** One text box holding one line, written as RTF and read back. */
function docOf(body: string) {
  const rtf = `{\\rtf0\\ansi\\uc1\\pard\\f0\\fs100\\cb3 ${body}}`;
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

const synthetic = () => syntheticTextPresentation();

describe("planning", () => {
  it("offers one fix per line, whatever it is guilty of", () => {
    const fixes = plan(synthetic());
    const keys = fixes.map((f) => `${f.boxIndex}:${f.lineIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("shows the line as it would read", () => {
    const fixes = plan(synthetic(), ["leadingSpace"]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].before).toBe(" leading space");
    expect(fixes[0].after).toBe("leading space");
  });

  it("leaves a single space between words when collapsing a run", () => {
    const fixes = plan(synthetic(), ["repeatedSpace"]);
    expect(fixes[0].before).toBe("two  spaces here");
    expect(fixes[0].after).toBe("two spaces here");
  });

  it("keeps the space rather than the tab when a run holds both", () => {
    // A real line read "Louons\t le Dieu qui guerit". Keeping the first
    // character of the run would leave the tab behind -- the same invisible
    // oddity in a narrower form.
    // `\\tab ` swallows one space as its delimiter, leaving tab-then-space.
    const doc = docOf("Louons\\tab  le Dieu");
    const fixes = planFixes(doc, checkPresentation("x.pro", doc).issues);
    expect(fixes[0].before).toBe("Louons\t le Dieu");
    expect(fixes[0].after).toBe("Louons le Dieu");
  });

  it("takes the whitespace around a trailing comma with it", () => {
    // "pour toujours ," would otherwise become "pour toujours ", trading one
    // finding for another.
    const fixes = plan(synthetic(), ["trailingComma"]);
    expect(fixes.map((f) => f.after)).toEqual(["Que ton nom", "pour toujours"]);
  });

  it("removes a trailing semicolon and a trailing full stop", () => {
    expect(plan(synthetic(), ["trailingSemicolon"]).map((f) => f.after)).toEqual(["Tu es saint"]);
    expect(plan(synthetic(), ["trailingFullStop"]).map((f) => f.after)).toEqual(["je te loue"]);
  });

  it("offers nothing for a line that ends in an ellipsis", () => {
    // Nothing reports it, so nothing plans it -- but the cut regex is a second
    // place the distinction could be lost, so it is asserted here too.
    const doc = docOf("et je chanterai\\u8230 ?");
    expect(doc.textBoxes[0].lines[0].text).toBe("et je chanterai\u2026");
    expect(
      planFixes(doc, [
        {
          kind: "trailingFullStop",
          boxIndex: 0,
          slideIndex: 0,
          cueName: "1",
          lineIndex: 0,
          text: doc.textBoxes[0].lines[0].text,
        },
      ])
    ).toEqual([]);
  });

  it("removes a blank line rather than rewriting it", () => {
    const fixes = plan(synthetic(), ["blankLine"]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].after).toBeNull();
  });

  it("settles several findings on one line with one edit", () => {
    const doc = readPresentation(decodePresentation(synthetic()));
    const issues = checkPresentation("x.pro", doc).issues;
    // Both edges of one line, plus the comma at the end of it.
    const busy = issues.filter((i) => i.boxIndex === 1);
    const fixes = planFixes(doc, [
      ...busy,
      { ...busy[0], kind: "trailingSpace" as const },
    ]);
    expect(fixes.filter((f) => f.lineIndex === busy[0].lineIndex)).toHaveLength(1);
  });

  it("offers nothing for a file with nothing wrong", () => {
    const doc = readPresentation(decodePresentation(synthetic()));
    expect(planFixes(doc, [])).toEqual([]);
  });
});

describe("applying", () => {
  it("fixes exactly the lines it was given and no others", () => {
    const bytes = synthetic();
    const before = linesOf(bytes);
    const fixes = plan(bytes, ["leadingSpace"]);
    const after = linesOf(applyFixes(bytes, fixes));

    expect(after[1]).toEqual(["Fine here", "leading space"]);
    // Every other box comes back exactly as it was.
    after.forEach((box, i) => {
      if (i !== 1) expect(box, `box ${i}`).toEqual(before[i]);
    });
  });

  it("shortens the box when a blank line is removed", () => {
    const bytes = synthetic();
    expect(linesOf(bytes)[3]).toEqual(["Above", "", "Below"]);
    const after = linesOf(applyFixes(bytes, plan(bytes, ["blankLine"])));
    expect(after[3]).toEqual(["Above", "Below"]);
  });

  it("clears every finding when everything is ticked", () => {
    const bytes = applyFixes(synthetic(), plan(synthetic()));
    const doc = readPresentation(decodePresentation(bytes));
    expect(checkPresentation("x.pro", doc).issues).toEqual([]);
  });

  it("leaves the presentation otherwise identical", () => {
    // Slides, names and groups all survive: a fix is a splice inside one text
    // box, not a rebuild of the file.
    const bytes = synthetic();
    const before = readPresentation(decodePresentation(bytes));
    const after = readPresentation(decodePresentation(applyFixes(bytes, plan(bytes))));
    expect(after.name).toBe(before.name);
    expect(after.slideCount).toBe(before.slideCount);
    expect(after.textBoxes.map((b) => [b.cueName, b.groupName])).toEqual(
      before.textBoxes.map((b) => [b.cueName, b.groupName])
    );
  });

  it("refuses when nothing was chosen", () => {
    expect(() => applyFixes(synthetic(), [])).toThrow(FixError);
  });

  it("refuses a fix planned against a file that has changed since", () => {
    // ProPresenter may have been open all along. The offsets a fix carries
    // describe the file as it was scanned and mean nothing against another.
    const bytes = synthetic();
    const [fix] = plan(bytes, ["leadingSpace"]);
    const alreadyFixed = applyFixes(bytes, [fix]);
    expect(() => applyFixes(alreadyFixed, [fix])).toThrow(
      expect.objectContaining({ reason: "stale" })
    );
  });

  it("refuses a fix whose promise it cannot keep", () => {
    // A fix claiming an outcome the edits do not produce must not reach disk,
    // whatever produced it.
    const bytes = synthetic();
    const [fix] = plan(bytes, ["leadingSpace"]);
    const lying: LineFix = { ...fix, after: "something else entirely" };
    expect(() => applyFixes(bytes, [lying])).toThrow(
      expect.objectContaining({ reason: "verifyFailed" })
    );
  });

  it("refuses to write a file it could not read faithfully", () => {
    // Truncated, so the re-encode cannot reproduce it.
    const bytes = synthetic();
    expect(() => applyFixes(bytes.slice(0, 40), plan(bytes))).toThrow(FixError);
  });
});

/**
 * The write path over somebody's actual library.
 *
 * Every file, every finding, fixed and read back. This is the run a reader
 * would make on a Saturday afternoon, and the only honest way to know whether
 * it is safe is to make it.
 */
describe.skipIf(!hasRealLibrary)("a whole real library", () => {
  let files: string[] = [];
  beforeAll(() => {
    if (!hasRealLibrary) return;
    files = libraryFiles();
  });

  it("fixes every findable problem and finds none afterwards", () => {
    let fixed = 0;
    let filesTouched = 0;

    for (const file of files) {
      const bytes = readLibraryFile(file);
      const fixes = plan(bytes);
      if (fixes.length === 0) continue;

      filesTouched++;
      fixed += fixes.length;

      const after = applyFixes(bytes, fixes);
      const doc = readPresentation(decodePresentation(after));
      // The file is clean now, and still a presentation: same name, same
      // slides, same sections.
      expect(checkPresentation(file, doc).issues, file).toEqual([]);
      expect(doc.slideCount, file).toBe(
        readPresentation(decodePresentation(bytes)).slideCount
      );
    }

    expect(filesTouched).toBeGreaterThan(0);
    expect(fixed).toBeGreaterThan(0);
  }, 120_000);

  it("changes only the lines it said it would", () => {
    for (const file of files) {
      const bytes = readLibraryFile(file);
      const fixes = plan(bytes);
      if (fixes.length === 0) continue;

      const before = linesOf(bytes);
      const after = linesOf(applyFixes(bytes, fixes));
      const touched = new Set(fixes.map((f) => f.boxIndex));

      before.forEach((box, index) => {
        if (touched.has(index)) return;
        expect(after[index], `${file} box ${index}`).toEqual(box);
      });
    }
  }, 120_000);
});

describe("running over several files", () => {
  const read = async () => syntheticTextPresentation();

  it("fixes each file and hands back the bytes", async () => {
    const plans = ["a.pro", "Chants/b.pro"].map((path) => ({
      path,
      fixes: plan(synthetic(), ["leadingSpace"]),
    }));
    const outcomes = await fixFiles(plans, { read });

    expect(outcomes.map((o) => o.path)).toEqual(["a.pro", "Chants/b.pro"]);
    for (const outcome of outcomes) {
      expect(outcome.reason).toBeUndefined();
      expect(linesOf(outcome.bytes!)[1]).toEqual(["Fine here", "leading space"]);
    }
  });

  it("writes through the folder when one is given", async () => {
    const written = new Map<string, Uint8Array>();
    await fixFiles([{ path: "a.pro", fixes: plan(synthetic(), ["leadingSpace"]) }], {
      read,
      write: async (path, bytes) => void written.set(path, bytes),
    });
    expect(linesOf(written.get("a.pro")!)[1]).toEqual(["Fine here", "leading space"]);
  });

  it("carries on past a file it cannot fix", async () => {
    // One unreadable presentation in a library of hundreds is the ordinary
    // case; abandoning the rest would be the wrong answer to it.
    const fixes = plan(synthetic(), ["leadingSpace"]);
    const outcomes = await fixFiles(
      [
        { path: "broken.pro", fixes },
        { path: "fine.pro", fixes },
      ],
      { read: async (path) => (path === "broken.pro" ? new Uint8Array([0x3c, 0xff]) : synthetic()) }
    );

    expect(outcomes[0].reason).toBe("unreadable");
    expect(outcomes[0].bytes).toBeUndefined();
    expect(outcomes[1].reason).toBeUndefined();
  });

  it("reports a file the folder would not take", async () => {
    const outcomes = await fixFiles([{ path: "a.pro", fixes: plan(synthetic(), ["leadingSpace"]) }], {
      read,
      write: async () => {
        throw new Error("permission lapsed");
      },
    });
    expect(outcomes[0].reason).toBe("writeFailed");
  });

  it("says which file it is on before it starts on it", async () => {
    // Before rather than after: during a run of several hundred the useful
    // question is what is happening now, not what has just finished.
    const seen: [string, number, number][] = [];
    const fixes = plan(synthetic(), ["leadingSpace"]);

    await fixFiles(
      ["a.pro", "b.pro", "c.pro"].map((path) => ({ path, fixes })),
      { read, onFile: (path, done, total) => void seen.push([path, done, total]) }
    );

    expect(seen).toEqual([
      ["a.pro", 0, 3],
      ["b.pro", 1, 3],
      ["c.pro", 2, 3],
    ]);
  });

  it("reports a file it goes on to refuse", async () => {
    // The count has to cover every file the run walks, or a run holding one
    // unreadable presentation would stop short of the end.
    const seen: number[] = [];
    await fixFiles([{ path: "broken.pro", fixes: plan(synthetic(), ["leadingSpace"]) }], {
      read: async () => new Uint8Array([0x3c, 0xff]),
      onFile: (_path, done) => void seen.push(done),
    });
    expect(seen).toEqual([0]);
  });
});

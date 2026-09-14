// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { beforeAll, describe, expect, it } from "vitest";
import {
  applyEdits,
  cutsToEdits,
  decodeRtf,
  encodeRtf,
  extractLines,
  lineEdit,
  type RtfLine,
} from "../rtf";
import { decodePresentation, readPresentation } from "../presentation";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

/** A minimal document with the header ProPresenter actually writes. */
function rtf(body: string): string {
  return (
    "{\\rtf0\\ansi\\ansicpg1252{\\fonttbl\\f0\\fnil ArialMT;}" +
    "{\\colortbl;\\red0\\green0\\blue0;}" +
    "{\\*\\expandedcolortbl;\\csgenericrgb\\c0\\c0\\c0\\c100000;}" +
    "{\\*\\listtable}{\\*\\listoverridetable}\\uc1\\pard\\f0\\fs100" +
    body +
    "}"
  );
}

/**
 * The invariants an offset has to satisfy to be worth splicing on.
 *
 * Checked directly rather than only through round-trips, because a failure
 * here names the broken property instead of leaving a mangled document to
 * puzzle over.
 */
function checkSpans(source: string, line: RtfLine, where: string) {
  let at = 0;
  for (const span of line.spans) {
    // The spans must tile the text exactly, in order and without gaps: a gap
    // is a character with no known origin, which could never be edited.
    expect(span.textStart, where).toBe(at);
    expect(span.textEnd, where).toBeGreaterThan(span.textStart);
    at = span.textEnd;

    expect(span.sourceStart, where).toBeGreaterThanOrEqual(0);
    expect(span.sourceEnd, where).toBeLessThanOrEqual(source.length);
    expect(span.sourceEnd, where).toBeGreaterThan(span.sourceStart);

    // A plain run really is the source characters, so a cut inside it is
    // arithmetic rather than guesswork.
    if (span.plain) {
      expect(source.slice(span.sourceStart, span.sourceEnd), where).toBe(
        line.text.slice(span.textStart, span.textEnd)
      );
    }
  }
  expect(at, where).toBe(line.text.length);
}

/** Remove one visible character and read the line back. */
function afterDeleting(source: string, lineIndex: number, at: number): string {
  const line = extractLines(source)[lineIndex];
  const edits = cutsToEdits(source, line, [{ start: at, end: at + 1 }]);
  expect(edits).not.toBeNull();
  return extractLines(applyEdits(source, edits!))[lineIndex].text;
}

describe("source offsets", () => {
  it("does not claim a control word's delimiter as text", () => {
    const source = rtf("\\cb3 Hello");
    const [line] = extractLines(source);
    checkSpans(source, line, "delimiter");
    expect(source.slice(line.spans[0].sourceStart, line.spans[0].sourceEnd)).toBe("Hello");
  });

  it("covers an escape and the fallback character standing in for it", () => {
    // `\u233 ?` is one visible "é" written as seven source characters, the
    // last of which is a fallback for readers without Unicode. Removing the
    // escape without it would leave a stray "?" on the slide.
    const source = rtf("\\cb3 caf\\u233 ?");
    const [line] = extractLines(source);
    expect(line.text).toBe("café");
    checkSpans(source, line, "escape");
    expect(afterDeleting(source, 0, 3)).toBe("caf");
  });

  it("refuses a cut that would take half an indivisible unit", () => {
    // No escape ProPresenter writes stands for more than one character, so
    // this cannot arise from a real file -- which is exactly why the contract
    // is asserted directly rather than through one. A half-removed escape is
    // the kind of corruption worth being unable to express.
    const line: RtfLine = {
      index: 0,
      text: "ab",
      markupOnly: false,
      spans: [{ textStart: 0, textEnd: 2, sourceStart: 0, sourceEnd: 9, plain: false }],
      sourceStart: 0,
      sourceEnd: 9,
    };
    expect(cutsToEdits("\\somesuch", line, [{ start: 0, end: 1 }])).toBeNull();
    expect(cutsToEdits("\\somesuch", line, [{ start: 0, end: 2 }])).toEqual([
      { start: 0, end: 9 },
    ]);
  });
});

describe("splicing", () => {
  it("reproduces the document when nothing is cut", () => {
    const source = rtf("\\cb3 Hello\\par\\pard\\cb3 World");
    expect(applyEdits(source, [])).toBe(source);
  });

  it("removes a leading space and leaves the formatting alone", () => {
    const source = rtf("\\cf1\\strokec2\\cb3  Hello");
    const line = extractLines(source)[0];
    expect(line.text).toBe(" Hello");
    const fixed = applyEdits(source, cutsToEdits(source, line, [{ start: 0, end: 1 }])!);
    expect(extractLines(fixed)[0].text).toBe("Hello");
    // Everything the reader ignores has to survive, which is the whole reason
    // for splicing rather than rewriting.
    expect(fixed).toContain("\\cf1\\strokec2\\cb3");
    expect(fixed).toContain("{\\fonttbl\\f0\\fnil ArialMT;}");
  });

  it("merges cuts that overlap rather than rejecting them", () => {
    // A trailing comma and the space behind it are two checks wanting the same
    // characters gone. That is agreement, not a conflict.
    const source = rtf("\\cb3 Que ton nom, ");
    const line = extractLines(source)[0];
    expect(line.text).toBe("Que ton nom, ");
    const edits = cutsToEdits(source, line, [
      { start: 11, end: 13 },
      { start: 12, end: 13 },
    ])!;
    expect(extractLines(applyEdits(source, edits))[0].text).toBe("Que ton nom");
  });

  it("removes a whole paragraph by its source extent", () => {
    const source = rtf("\\cb3 Above\\par\\pard\\li0\\qc\\fs200\\par\\pard\\cb3 Below");
    const lines = extractLines(source);
    expect(lines.map((l) => l.text)).toEqual(["Above", "", "Below"]);
    const fixed = applyEdits(source, [lineEdit(source, lines[1])!]);
    expect(extractLines(fixed).map((l) => l.text)).toEqual(["Above", "Below"]);
  });

  it("will not remove a line that nothing terminated", () => {
    // The last line of a document has no break to take with it -- and is never
    // a gap between two others, so nothing ever asks.
    const source = rtf("\\cb3 Only");
    expect(lineEdit(source, extractLines(source)[0])).toBeNull();
  });

  it("puts a delimiter back when a cut leaves a control word exposed", () => {
    // The trap this whole module exists for, running backwards: `\cb2` has no
    // delimiter because the escape separates it from the text, so removing the
    // escape would let the leading space become one.
    const source = rtf("\\cb2\\u212 ? ce nom");
    const line = extractLines(source)[0];
    expect(line.text).toBe("\u00d4 ce nom");
    const fixed = applyEdits(source, cutsToEdits(source, line, [{ start: 0, end: 1 }])!);
    expect(extractLines(fixed)[0].text).toBe(" ce nom");
  });

  it("does not add a delimiter to a control word that has one", () => {
    // Two spaces here would be a leading space of their own making.
    const source = rtf("\\cb3 Hello");
    const line = extractLines(source)[0];
    const fixed = applyEdits(source, cutsToEdits(source, line, [{ start: 0, end: 1 }])!);
    expect(extractLines(fixed)[0].text).toBe("ello");
  });
});

describe("latin-1 payloads", () => {
  it("round-trips any byte unchanged", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(encodeRtf(decodeRtf(bytes)))).toEqual(Array.from(bytes));
  });
});

/**
 * The gate the whole write side rests on.
 *
 * If splicing cannot reproduce a real text box byte for byte, the offsets are
 * wrong and nothing built on them can be trusted -- so this runs over every
 * text box in a real library rather than over a sample. Only a machine with
 * one runs it; CI has no library and skips.
 */
describe.skipIf(!hasRealLibrary)("every text box in a real library", () => {
  let payloads: { file: string; rtf: string; bytes: Uint8Array }[] = [];

  beforeAll(() => {
    // Read here, not in the describe body: vitest runs a describe body during
    // collection even for a suite that will be skipped.
    if (!hasRealLibrary) return;
    for (const file of libraryFiles()) {
      const doc = readPresentation(decodePresentation(readLibraryFile(file)));
      for (const box of doc.textBoxes) {
        payloads.push({ file, rtf: box.rtf, bytes: encodeRtf(box.rtf) });
      }
    }
  });

  it("splices back to the original bytes when nothing is cut", () => {
    expect(payloads.length).toBeGreaterThan(100);
    for (const { file, rtf: source, bytes } of payloads) {
      const again = encodeRtf(applyEdits(source, []));
      expect(Buffer.compare(Buffer.from(bytes), Buffer.from(again)), file).toBe(0);
    }
  });

  it("maps every visible character back to the source it came from", () => {
    for (const { file, rtf: source } of payloads) {
      for (const line of extractLines(source)) checkSpans(source, line, file);
    }
  });

  it("deletes any single character without disturbing the rest", () => {
    // The strongest form of the gate: for every character of every line of
    // every box, cutting it must yield exactly that line minus that character
    // and leave every other line alone. Six hundred thousand characters, so
    // the comparison is plain JavaScript and only a failure reaches expect --
    // half a million assertions take minutes where the work itself takes
    // seconds.
    const failures: string[] = [];

    for (const { file, rtf: source } of payloads) {
      const lines = extractLines(source);
      const before = lines.map((l) => l.text);

      lines.forEach((line, index) => {
        for (let at = 0; at < line.text.length && failures.length < 5; at++) {
          const edits = cutsToEdits(source, line, [{ start: at, end: at + 1 }]);
          if (edits === null) continue; // an indivisible unit: no fix offered
          const expected = [...before];
          expected[index] = line.text.slice(0, at) + line.text.slice(at + 1);

          const after = extractLines(applyEdits(source, edits)).map((l) => l.text);
          if (after.length !== expected.length || after.some((t, n) => t !== expected[n])) {
            failures.push(
              `${file} line ${index} char ${at}: ${JSON.stringify(after)} != ${JSON.stringify(expected)}`
            );
          }
        }
      });
    }

    expect(failures).toEqual([]);
    // Six hundred thousand splices and re-reads; well past the default limit,
    // and worth the seconds it costs.
  }, 120_000);

  it("trims every line at once and changes nothing else", () => {
    // What a fix run actually does, rather than a synthetic single cut: every
    // line of a box edited in one splice.
    const failures: string[] = [];

    for (const { file, rtf: source } of payloads) {
      const lines = extractLines(source);
      const edits = lines.flatMap((line) => {
        const lead = line.text.length - line.text.trimStart().length;
        const trail = line.text.length - line.text.trimEnd().length;
        if (lead === 0 && trail === 0) return [];
        return (
          cutsToEdits(source, line, [
            { start: 0, end: lead },
            { start: line.text.length - trail, end: line.text.length },
          ]) ?? []
        );
      });
      if (edits.length === 0) continue;

      const after = extractLines(applyEdits(source, edits)).map((l) => l.text);
      const expected = lines.map((l) => l.text.trim());
      if (after.length !== expected.length || after.some((t, n) => t !== expected[n])) {
        failures.push(`${file}: ${JSON.stringify(after.slice(0, 4))}`);
      }
      if (failures.length >= 5) break;
    }

    expect(failures).toEqual([]);
  });
});

describe("the synthetic presentation", () => {
  it("survives deleting each character of each line in turn", () => {
    const doc = readPresentation(decodePresentation(syntheticTextPresentation()));
    for (const box of doc.textBoxes) {
      const lines = extractLines(box.rtf);
      const before = lines.map((l) => l.text);
      lines.forEach((line, index) => {
        for (let at = 0; at < line.text.length; at++) {
          const edits = cutsToEdits(box.rtf, line, [{ start: at, end: at + 1 }])!;
          const expected = [...before];
          expected[index] = line.text.slice(0, at) + line.text.slice(at + 1);
          expect(extractLines(applyEdits(box.rtf, edits)).map((l) => l.text)).toEqual(expected);
        }
      });
    }
  });
});

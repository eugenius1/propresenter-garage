import { beforeAll, describe, expect, it } from "vitest";
import { applyFixes, EditError, FixError, planLineEdits, type LineChange } from "../fixes";
import { decodePresentation, readPresentation } from "../presentation";
import {
  applyEdits,
  encodeRtfText,
  extractLines,
  lineEdit,
  replaceLineText,
  unicodeSkipAt,
} from "../rtf";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

/**
 * Writing new text into a line, rather than only cutting characters out.
 *
 * The same contract as the deletion gate in `rtf-splice.test.ts`: the edited
 * line reads exactly what was asked for, and no other line reads any
 * differently. Checked exhaustively over hand-written documents built to hit
 * every trap the deletion side has met, and over every line of a real library
 * where there is one.
 */

/** A minimal document with the header ProPresenter actually writes. */
function rtf(body: string, uc = "\\uc1"): string {
  return (
    "{\\rtf0\\ansi\\ansicpg1252{\\fonttbl\\f0\\fnil ArialMT;}" +
    "{\\colortbl;\\red0\\green0\\blue0;}" +
    `${uc}\\pard\\f0\\fs100` +
    body +
    "}"
  );
}

/** Make one line read `after` and return every line's text. */
function edit(source: string, lineIndex: number, after: string): string[] {
  const line = extractLines(source)[lineIndex];
  const edits = replaceLineText(source, line, after);
  expect(edits, JSON.stringify(after)).not.toBeNull();
  return extractLines(applyEdits(source, edits!)).map((l) => l.text);
}

/** Every line as it was, with one replaced. */
function expected(source: string, lineIndex: number, after: string): string[] {
  const lines = extractLines(source).map((l) => l.text);
  lines[lineIndex] = after;
  return lines;
}

/**
 * Documents chosen for the traps: an escape right after a control word with no
 * delimiter, a fallback count other than one, a nested formatting group, a
 * blank line of formatting, a literal brace and backslash, a code point past
 * the BMP written as a surrogate pair, and a placeholder with no text at all.
 */
const TRICKY = [
  rtf("\\cb3 Que ton nom\\par\\pard\\cb3 pour toujours"),
  rtf("\\cb2\\u212 ? ce nom\\par\\pard\\qc\\u212 ?abc"),
  rtf("\\cb3 caf\\u233 ? cr\\u232 ?me", "\\uc0"),
  rtf("\\cb3 deux \\u233 ??x", "\\uc2"),
  rtf("\\cb3 a {\\b bold} word\\par\\pard\\li0\\qc\\fs200\\par\\pard\\cb3 Below"),
  rtf("\\cb3 \\{brace\\} and \\\\ slash\\tab end"),
  rtf("\\cb3 joy \\u-10179 ?\\u-8704 ? here"),
  rtf("\\cb3"),
  rtf("\\cb3 one\\line two\\line\\line four"),
];

/** What gets typed: plain, accented, reserved by RTF, a tab, a digit, past the BMP. */
const INSERTS = ["x", "é", "{", "}", "\\", "\t", "5", " ", "😀", "-1", "Ω ok"];

describe("encoding plain text", () => {
  it("escapes what RTF reserves and spells a tab as a control word", () => {
    expect(encodeRtfText("a{b}c\\d\te", 1)).toBe("a\\{b\\}c\\\\d\\tab e");
  });

  it("writes everything above ASCII as \\u escapes, with the fallbacks in force", () => {
    expect(encodeRtfText("é", 1)).toBe("\\u233 ?");
    expect(encodeRtfText("é", 0)).toBe("\\u233 ");
    expect(encodeRtfText("é", 2)).toBe("\\u233 ??");
  });

  it("writes a character past the BMP as a signed surrogate pair", () => {
    expect(encodeRtfText("😀", 1)).toBe("\\u-10179 ?\\u-8704 ?");
  });

  it("refuses a line break or any other control character", () => {
    expect(encodeRtfText("two\nlines", 1)).toBeNull();
    expect(encodeRtfText("bell\u0007", 1)).toBeNull();
  });
});

describe("the \\uc in force", () => {
  it("defaults to one and follows the group stack", () => {
    const source = "{\\rtf1\\uc2 a{\\uc0 b}c}";
    expect(unicodeSkipAt(source, 1)).toBe(1);
    expect(unicodeSkipAt(source, source.indexOf("a"))).toBe(2);
    expect(unicodeSkipAt(source, source.indexOf("b"))).toBe(0);
    expect(unicodeSkipAt(source, source.indexOf("c"))).toBe(2);
  });

  it("is not fooled by an escaped brace", () => {
    const source = "{\\rtf1\\uc2 \\{ a}";
    expect(unicodeSkipAt(source, source.indexOf("a"))).toBe(2);
  });
});

describe("replacing a line's text", () => {
  it("touches only what differs, so formatting elsewhere on the line stays", () => {
    const source = rtf("\\cb3 a {\\b bold} word");
    const line = extractLines(source)[0];
    const fixed = applyEdits(source, replaceLineText(source, line, "a bold Word")!);
    expect(fixed).toContain("{\\b bold} Word");
    expect(extractLines(fixed)[0].text).toBe("a bold Word");
  });

  it("delimits a control word the new text would otherwise run into", () => {
    // `\cb2\u212 ?` shows "Ô"; replacing it with "x" must not leave `\cb2x`.
    const source = rtf("\\cb2\\u212 ? ce nom");
    expect(edit(source, 0, "x ce nom")).toEqual(["x ce nom"]);
  });

  it("fills an empty placeholder box inside the document, not after it", () => {
    const source = rtf("\\cb3");
    const fixed = applyEdits(source, replaceLineText(source, extractLines(source)[0], "Hello")!);
    expect(fixed.endsWith("Hello}")).toBe(true);
    expect(extractLines(fixed).map((l) => l.text)).toEqual(["Hello"]);
  });

  it("writes into a blank line between two others", () => {
    const source = rtf("\\cb3 Above\\par\\pard\\li0\\qc\\fs200\\par\\pard\\cb3 Below");
    expect(edit(source, 1, "Middle")).toEqual(["Above", "Middle", "Below"]);
  });

  it("asks for nothing when the line already reads that", () => {
    const source = rtf("\\cb3 same");
    expect(replaceLineText(source, extractLines(source)[0], "same")).toEqual([]);
  });

  it("refuses text that would not sit on one line", () => {
    const source = rtf("\\cb3 one");
    expect(replaceLineText(source, extractLines(source)[0], "one\ntwo")).toBeNull();
  });

  it("keeps an insertion at the edge of a removed line apart from that removal", () => {
    // Removing line 0 takes its break; writing at the very start of line 1
    // lands where that removal ends. The two must not merge and lose the text.
    const source = "{\\rtf1 one\\par two}";
    const lines = extractLines(source);
    const edits = [...lineEdit(source, lines[0])!, ...replaceLineText(source, lines[1], "Xtwo")!];
    expect(extractLines(applyEdits(source, edits)).map((l) => l.text)).toEqual(["Xtwo"]);
  });

  for (const [n, source] of TRICKY.entries()) {
    it(`inserts, replaces and removes anywhere in tricky document ${n}`, () => {
      const failures: string[] = [];
      extractLines(source).forEach((line, index) => {
        const text = line.text;
        const tries: string[] = [];
        for (let at = 0; at <= text.length; at++) {
          for (const insert of INSERTS) tries.push(text.slice(0, at) + insert + text.slice(at));
          if (at < text.length) {
            tries.push(text.slice(0, at) + text.slice(at + 1));
            tries.push(text.slice(0, at) + "Z" + text.slice(at + 1));
          }
        }
        tries.push("", "Entirely new text, é {}", text.toUpperCase());

        for (const after of tries) {
          if (after === text) continue;
          const edits = replaceLineText(source, line, after);
          // Emptying a bare last line is the one honest refusal: it would
          // read back as no line at all.
          if (edits === null) {
            if (after !== "" || line.breakStart !== undefined) {
              failures.push(`line ${index} refused ${JSON.stringify(after)}`);
            }
            continue;
          }
          const got = extractLines(applyEdits(source, edits)).map((l) => l.text);
          const want = expected(source, index, after);
          if (got.length !== want.length || got.some((t, i) => t !== want[i])) {
            failures.push(`line ${index} → ${JSON.stringify(after)}: got ${JSON.stringify(got)}`);
          }
          if (failures.length >= 5) break;
        }
      });
      expect(failures).toEqual([]);
    });
  }
});

describe("planning line edits on a presentation", () => {
  const bytes = () => syntheticTextPresentation();
  const doc = () => readPresentation(decodePresentation(bytes()));
  const linesOf = (b: Uint8Array) => readPresentation(decodePresentation(b)).textBoxes.map((x) => x.lines.map((l) => l.text));

  it("writes several lines across boxes and reads back exactly that", () => {
    const changes: LineChange[] = [
      { boxIndex: 0, lineIndex: 0, text: "A tidier line" },
      { boxIndex: 0, lineIndex: 1, text: "And one more" },
      { boxIndex: 5, lineIndex: 0, text: "Filled placeholder" },
      { boxIndex: 3, lineIndex: 1, text: null },
    ];
    const fixes = planLineEdits(doc(), changes);
    const want = linesOf(bytes());
    want[0] = ["A tidier line", "And one more"];
    want[5] = ["Filled placeholder"];
    want[3] = ["Above", "Below"];
    expect(linesOf(applyFixes(bytes(), fixes))).toEqual(want);
  });

  it("describes each change as the fixer does, so it can be shown before it is made", () => {
    const [fix] = planLineEdits(doc(), [{ boxIndex: 6, lineIndex: 0, text: "Que ton nom" }]);
    expect(fix).toMatchObject({ before: "Que ton nom,", after: "Que ton nom", groupName: "Chorus", kinds: [] });
  });

  it("refuses the lot when one change cannot be made", () => {
    const refuse = (changes: LineChange[]) => {
      try {
        planLineEdits(doc(), changes);
      } catch (e) {
        expect(e).toBeInstanceOf(EditError);
        return (e as EditError).reason;
      }
      return "planned";
    };
    expect(refuse([{ boxIndex: 99, lineIndex: 0, text: "x" }])).toBe("noSuchLine");
    expect(refuse([{ boxIndex: 0, lineIndex: 9, text: "x" }])).toBe("noSuchLine");
    expect(refuse([{ boxIndex: 0, lineIndex: 0, text: "A tidy line" }])).toBe("unchanged");
    expect(refuse([{ boxIndex: 0, lineIndex: 0, text: "two\nlines" }])).toBe("unsupported");
    // The last line of a box has no break to take with it.
    expect(refuse([{ boxIndex: 0, lineIndex: 1, text: null }])).toBe("unsupported");
    expect(
      refuse([
        { boxIndex: 0, lineIndex: 0, text: "a" },
        { boxIndex: 0, lineIndex: 0, text: "b" },
      ])
    ).toBe("duplicate");
  });

  it("is refused as stale against a file that changed since it was planned", () => {
    const fixes = planLineEdits(doc(), [{ boxIndex: 0, lineIndex: 0, text: "Changed" }]);
    const moved = applyFixes(bytes(), planLineEdits(doc(), [{ boxIndex: 0, lineIndex: 1, text: "Elsewhere" }]));
    expect(() => applyFixes(moved, fixes)).toThrow(FixError);
  });
});

/**
 * The gate for writing text, over a real library: for every line of every
 * box, a character typed at the start, the middle and the end, an accented
 * word replacing the whole line, and RTF's reserved characters, each read back
 * exactly and every other line untouched. Only a machine with a library runs
 * it; CI skips.
 */
describe.skipIf(!hasRealLibrary)("writing into every line of a real library", () => {
  const sources: { file: string; rtf: string }[] = [];

  beforeAll(() => {
    if (!hasRealLibrary) return;
    for (const file of libraryFiles()) {
      for (const box of readPresentation(decodePresentation(readLibraryFile(file))).textBoxes) {
        sources.push({ file, rtf: box.rtf });
      }
    }
  });

  it("reads back exactly what was written and nothing else", () => {
    expect(sources.length).toBeGreaterThan(100);
    const failures: string[] = [];

    for (const { file, rtf: source } of sources) {
      const lines = extractLines(source);
      const before = lines.map((l) => l.text);
      lines.forEach((line, index) => {
        const t = line.text;
        const mid = Math.floor(t.length / 2);
        const tries = ["x" + t, t.slice(0, mid) + "é" + t.slice(mid), t + " {\\}", "Ça ira 😀", t.toUpperCase()];
        for (const after of tries) {
          if (after === t || failures.length >= 5) continue;
          const edits = replaceLineText(source, line, after);
          if (edits === null) {
            failures.push(`${file} line ${index}: refused ${JSON.stringify(after)}`);
            continue;
          }
          const got = extractLines(applyEdits(source, edits)).map((l) => l.text);
          const want = [...before];
          want[index] = after;
          if (got.length !== want.length || got.some((x, n) => x !== want[n])) {
            failures.push(`${file} line ${index} → ${JSON.stringify(after)}: ${JSON.stringify(got)}`);
          }
        }
      });
    }

    expect(failures).toEqual([]);
  }, 120_000);
});

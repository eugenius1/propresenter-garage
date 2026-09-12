// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { describe, expect, it } from "vitest";
import { extractLines, extractText } from "../rtf";

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

describe("control words are syntax, not text", () => {
  it("does not mistake a control word's terminating space for a leading space", () => {
    // The bug this parser exists to avoid: in `\cb2 Hello` the space after the
    // control word delimits it. Matching spaces with a regular expression
    // reports a leading space on essentially every line of every real file.
    const [line] = extractLines(rtf("\\cf1\\strokec2\\highlight3\\cb3 Hello"));
    expect(line.text).toBe("Hello");
  });

  it("keeps a space that really is in the text", () => {
    // Two spaces: one delimits \cb3, the second is content.
    const [line] = extractLines(rtf("\\cb3  Hello"));
    expect(line.text).toBe(" Hello");
  });

  it("keeps a trailing space", () => {
    const [line] = extractLines(rtf("\\cb3 Hello "));
    expect(line.text).toBe("Hello ");
  });

  it("reads a numeric parameter without leaking it into the text", () => {
    const [line] = extractLines(rtf("\\fs200\\expndtw-40 Text"));
    expect(line.text).toBe("Text");
  });
});

describe("hidden groups", () => {
  it("ignores the font and colour tables", () => {
    expect(extractText(rtf("\\cb3 Only this"))).toBe("Only this");
  });

  it("ignores a group marked ignorable", () => {
    const [line] = extractLines(rtf("\\cb3 Visible{\\*\\unknowndest hidden text}"));
    expect(line.text).toBe("Visible");
  });

  it("resumes reading after an ignorable group closes", () => {
    const [line] = extractLines(rtf("\\cb3 One{\\*\\foo skip me} two"));
    expect(line.text).toBe("One two");
  });
});

describe("lines", () => {
  it("splits on \\par", () => {
    const lines = extractLines(rtf("\\cb3 First\\par\\pard\\cb3 Second"));
    expect(lines.map((l) => l.text)).toEqual(["First", "Second"]);
  });

  it("splits on \\line as well", () => {
    expect(extractLines(rtf("\\cb3 First\\line Second")).map((l) => l.text)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("keeps an empty line between two full ones", () => {
    const lines = extractLines(rtf("\\cb3 First\\par\\pard\\par\\pard\\cb3 Third"));
    expect(lines.map((l) => l.text)).toEqual(["First", "", "Third"]);
  });

  it("marks a line that carries formatting but shows nothing", () => {
    const lines = extractLines(rtf("\\cb3 First\\par\\pard\\li0\\fi0\\qc\\fs200\\par\\pard\\cb3 Third"));
    expect(lines[1].text).toBe("");
    expect(lines[1].markupOnly).toBe(true);
  });

  it("numbers lines from zero", () => {
    const lines = extractLines(rtf("\\cb3 a\\par\\pard\\cb3 b\\par\\pard\\cb3 c"));
    expect(lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });
});

describe("escapes and unicode", () => {
  it("decodes \\u escapes and swallows the fallback character", () => {
    // `\u233 ?` is é followed by the ANSI stand-in that \uc1 says to drop.
    const [line] = extractLines(rtf("\\cb3 r\\u233 ?sonne"));
    expect(line.text).toBe("résonne");
  });

  it("honours a \\uc count greater than one", () => {
    const [line] = extractLines(rtf("\\uc2\\cb3 a\\u233 ??b"));
    expect(line.text).toBe("aéb");
  });

  it("handles code points written as negative numbers", () => {
    // RTF writes anything above 0x7FFF as a signed 16-bit value.
    const [line] = extractLines(rtf("\\cb3 \\u-10179 ?"));
    expect(line.text.codePointAt(0)).toBe(55357);
  });

  it("unescapes braces and backslashes", () => {
    const [line] = extractLines(rtf("\\cb3 a\\{b\\}c\\\\d"));
    expect(line.text).toBe("a{b}c\\d");
  });

  it("treats a non-breaking space as a space", () => {
    const [line] = extractLines(rtf("\\cb3 a\\~b"));
    expect(line.text).toBe("a b");
  });

  it("renders a tab", () => {
    const [line] = extractLines(rtf("\\cb3 a\\tab b"));
    expect(line.text).toBe("a\tb");
  });
});

describe("robustness", () => {
  it("returns a single empty line for an empty document", () => {
    expect(extractLines("{\\rtf0\\ansi}").map((l) => l.text)).toEqual([""]);
  });

  it("does not throw on truncated input", () => {
    expect(() => extractLines("{\\rtf0\\ansi\\cb3 unterminated")).not.toThrow();
  });

  it("ignores raw newlines, which are not line breaks in RTF", () => {
    const [line] = extractLines(rtf("\\cb3 one\ntwo"));
    expect(line.text).toBe("onetwo");
  });
});

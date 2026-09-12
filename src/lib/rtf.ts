// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Just enough RTF to recover the text a slide actually shows.
 *
 * ProPresenter stores every text box as an RTF document, so answering "does
 * this line begin with a space?" means knowing which spaces are text and which
 * are syntax. In RTF a control word is terminated by a single space that is
 * *not* content: in `\cb2 Que ton nom`, the space after `\cb2` is a delimiter.
 * Matching spaces with a regular expression reports a leading space on
 * essentially every line in every file.
 *
 * Nothing here tries to be a general RTF reader. It recovers visible characters
 * and line breaks, and deliberately ignores everything about appearance.
 */

/** Groups whose contents are never shown: font tables, colour tables and so on. */
const DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "expandedcolortbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "info",
  "pict",
  "object",
  "themedata",
  "colorschememapping",
  "datastore",
  "generator",
  "xmlnstbl",
]);

/** Control words that produce a character rather than affecting appearance. */
const LITERAL: Record<string, string> = {
  tab: "\t",
  emdash: "—",
  endash: "–",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
  bullet: "•",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  nbsp: " ",
};

/** Control words that end the current line. */
const BREAKS = new Set(["par", "line", "sect", "page", "column"]);

export interface RtfLine {
  /** Zero-based position within the text box. */
  index: number;
  /**
   * The visible characters, untrimmed.
   *
   * Untrimmed on purpose -- the leading and trailing whitespace is the whole
   * point of reading this.
   */
  text: string;
  /**
   * True when the line carried formatting but renders nothing.
   *
   * A line can be non-empty in the file and invisible on screen: a paragraph
   * holding only colour and font instructions. Those are what make a slide look
   * like it has a gap in it for no reason.
   */
  markupOnly: boolean;
}

interface ParseState {
  text: string;
  /** Whether anything at all appeared between this break and the last. */
  sawMarkup: boolean;
}

/**
 * Recover the lines of text an RTF document renders.
 *
 * Returns one entry per paragraph or explicit line break, including empty ones,
 * because their emptiness is often the finding.
 */
export function extractLines(rtf: string): RtfLine[] {
  const lines: RtfLine[] = [];
  let current: ParseState = { text: "", sawMarkup: false };

  // Depth of the group stack, and the depths at which we are inside something
  // that should not contribute visible text.
  let depth = 0;
  const skipFrom: number[] = [];
  const skipping = () => skipFrom.length > 0;

  /** Unicode replacement characters still to swallow, per \ucN. */
  let skipChars = 0;
  let unicodeSkip = 1;
  // \ucN is scoped to its group, so the stack restores it on exit.
  const ucStack: number[] = [];

  const endLine = () => {
    lines.push({
      index: lines.length,
      text: current.text,
      markupOnly: current.text.trim() === "" && current.sawMarkup,
    });
    current = { text: "", sawMarkup: false };
  };

  const emit = (s: string) => {
    if (skipping()) return;
    if (skipChars > 0) {
      // Characters standing in for a \u escape on readers without Unicode.
      const take = Math.min(skipChars, s.length);
      skipChars -= take;
      s = s.slice(take);
      if (!s) return;
    }
    current.text += s;
  };

  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === "{") {
      depth++;
      ucStack.push(unicodeSkip);
      i++;
      continue;
    }

    if (ch === "}") {
      if (skipFrom.length && skipFrom[skipFrom.length - 1] === depth) skipFrom.pop();
      unicodeSkip = ucStack.pop() ?? 1;
      depth--;
      i++;
      continue;
    }

    if (ch === "\\") {
      const next = rtf[i + 1];

      // Control symbol: a single non-alphabetic character.
      if (next !== undefined && !/[a-zA-Z]/.test(next)) {
        i += 2;
        if (next === "\\" || next === "{" || next === "}") emit(next);
        else if (next === "~") emit(" ");
        else if (next === "_") emit("‑");
        else if (next === "-") {
          // Optional hyphen: invisible unless the line wraps there.
        } else if (next === "*") {
          // `{\*\foo ...}` marks a group a reader may ignore wholesale.
          if (!skipping()) skipFrom.push(depth);
        } else if (next === "\n" || next === "\r") {
          endLine();
        }
        continue;
      }

      // Control word, with an optional signed numeric parameter.
      const match = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i));
      if (!match) {
        i++;
        continue;
      }
      const [whole, word, rawParam] = match;
      const param = rawParam === undefined ? undefined : Number(rawParam);
      i += whole.length;

      if (DESTINATIONS.has(word)) {
        if (!skipping()) skipFrom.push(depth);
        continue;
      }

      if (word === "uc") {
        unicodeSkip = param ?? 1;
        continue;
      }

      if (word === "u" && param !== undefined) {
        // Negative values are the signed-16-bit form of code points above
        // 0x7FFF, which is how RTF writes anything past the BMP midpoint.
        const code = param < 0 ? param + 65536 : param;
        if (!skipping()) {
          current.sawMarkup = true;
          current.text += String.fromCodePoint(code);
        }
        skipChars = unicodeSkip;
        continue;
      }

      if (BREAKS.has(word)) {
        if (!skipping()) endLine();
        continue;
      }

      if (word in LITERAL) {
        emit(LITERAL[word]);
        continue;
      }

      // Any other control word is formatting. Note that the line carries
      // *something*, which is what separates a blank line from a blank line
      // full of instructions.
      if (!skipping()) current.sawMarkup = true;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      // Raw newlines are insignificant in RTF; real breaks are \par and \line.
      i++;
      continue;
    }

    emit(ch);
    i++;
  }

  // Whatever is left is the final line, even when nothing terminated it.
  if (current.text !== "" || current.sawMarkup || lines.length === 0) endLine();

  return lines;
}

/** The visible text of an RTF document, lines joined by newlines. */
export function extractText(rtf: string): string {
  return extractLines(rtf)
    .map((line) => line.text)
    .join("\n");
}

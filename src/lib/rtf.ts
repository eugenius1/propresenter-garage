// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Just enough RTF to recover the text a slide actually shows -- and to put it
 * back.
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
 *
 * Because the text it returns is a *projection*, fixing a line cannot mean
 * rewriting that string: the formatting runs around it would be lost. So every
 * visible character also carries the range of source it came from, and a fix is
 * a splice of those ranges back into the original document. Everything outside
 * the spliced ranges is passed through untouched, which is what keeps a fix
 * from disturbing fonts, colours or anything else this reader ignores.
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

/**
 * Where one run of visible characters came from in the source.
 *
 * `plain` runs are the source characters themselves, so a cut anywhere inside
 * one maps straight onto a source range. Everything else -- a `\tab`, an
 * `\u233 ?` escape -- is an indivisible unit: one visible character standing
 * for several source characters, which can only be removed whole.
 */
export interface RtfSpan {
  /** Offset of the run's first character within the line's text. */
  textStart: number;
  /** One past its last character within the line's text. */
  textEnd: number;
  /** The source range that produced it. */
  sourceStart: number;
  sourceEnd: number;
  /** Whether the source characters are literally the text characters. */
  plain: boolean;
}

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
  /** Where each run of `text` came from, in order. */
  spans: RtfSpan[];
  /**
   * The source this line occupies, formatting included, up to but excluding
   * the break that ends it.
   *
   * Starts where the previous line's break ended, so the range covers the
   * paragraph's own instructions as well as its text -- removing a line means
   * removing both.
   */
  sourceStart: number;
  sourceEnd: number;
  /**
   * The break that ended the line, when one did.
   *
   * Absent on the last line of a document, which simply runs out.
   */
  breakStart?: number;
  breakEnd?: number;
}

interface ParseState {
  text: string;
  /** Whether anything at all appeared between this break and the last. */
  sawMarkup: boolean;
  spans: RtfSpan[];
}

/**
 * Recover the lines of text an RTF document renders.
 *
 * Returns one entry per paragraph or explicit line break, including empty ones,
 * because their emptiness is often the finding.
 */
export function extractLines(rtf: string): RtfLine[] {
  const lines: RtfLine[] = [];
  let current: ParseState = { text: "", sawMarkup: false, spans: [] };
  /** Where the line being built begins, formatting included. */
  let lineStart = 0;

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

  const push = (s: string, start: number, end: number, plain: boolean) => {
    const last = current.spans[current.spans.length - 1];
    // Merge consecutive literal characters: a line of prose is one run, not
    // one span per letter.
    if (last && plain && last.plain && last.sourceEnd === start && last.textEnd === current.text.length) {
      last.textEnd += s.length;
      last.sourceEnd = end;
    } else {
      current.spans.push({
        textStart: current.text.length,
        textEnd: current.text.length + s.length,
        sourceStart: start,
        sourceEnd: end,
        plain,
      });
    }
    current.text += s;
  };

  const endLine = (breakStart?: number, breakEnd?: number, at = breakStart) => {
    lines.push({
      index: lines.length,
      text: current.text,
      markupOnly: current.text.trim() === "" && current.sawMarkup,
      spans: current.spans,
      sourceStart: lineStart,
      sourceEnd: at ?? rtf.length,
      breakStart,
      breakEnd,
    });
    lineStart = breakEnd ?? at ?? rtf.length;
    current = { text: "", sawMarkup: false, spans: [] };
  };

  const emit = (s: string, start: number, end: number, plain: boolean) => {
    if (skipping()) return;
    if (skipChars > 0) {
      // Characters standing in for a \u escape on readers without Unicode.
      const take = Math.min(skipChars, s.length);
      skipChars -= take;
      // They belong to that escape's source range: removing the escape without
      // them would leave its "?" fallback behind as visible text.
      const last = current.spans[current.spans.length - 1];
      if (last) last.sourceEnd = Math.max(last.sourceEnd, end);
      s = s.slice(take);
      if (!s) return;
    }
    push(s, start, end, plain);
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
        const start = i;
        i += 2;
        if (next === "\\" || next === "{" || next === "}") emit(next, start, i, false);
        else if (next === "~") emit(" ", start, i, false);
        else if (next === "_") emit("‑", start, i, false);
        else if (next === "-") {
          // Optional hyphen: invisible unless the line wraps there.
        } else if (next === "*") {
          // `{\*\foo ...}` marks a group a reader may ignore wholesale.
          if (!skipping()) skipFrom.push(depth);
        } else if (next === "\n" || next === "\r") {
          endLine(start, i);
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
      const start = i;
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
          push(String.fromCodePoint(code), start, i, false);
        }
        skipChars = unicodeSkip;
        continue;
      }

      if (BREAKS.has(word)) {
        if (!skipping()) endLine(start, i);
        continue;
      }

      if (word in LITERAL) {
        emit(LITERAL[word], start, i, false);
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

    emit(ch, i, i + 1, true);
    i++;
  }

  // Whatever is left is the final line, even when nothing terminated it.
  if (current.text !== "" || current.sawMarkup || lines.length === 0) {
    endLine(undefined, undefined, rtf.length);
  }

  return lines;
}

/** The visible text of an RTF document, lines joined by newlines. */
export function extractText(rtf: string): string {
  return extractLines(rtf)
    .map((line) => line.text)
    .join("\n");
}

/** A stretch of a line's visible text to remove, in the line's own coordinates. */
export interface TextCut {
  start: number;
  /** Exclusive. */
  end: number;
}

/** A stretch of the source document to remove. */
export interface SourceEdit {
  start: number;
  /** Exclusive. */
  end: number;
  /**
   * Text to leave in its place, which is only ever a delimiter space.
   *
   * See {@link endsWithControlWord}: removing a run can leave a control word
   * touching what follows it, and a control word with nothing between it and
   * the next character redefines what that character means.
   */
  insert?: string;
}

/**
 * Whether the source immediately before `index` ends a control word that has
 * not been given its delimiter.
 *
 * The reason this matters is the module's own opening paragraph, in reverse.
 * A control word is terminated by one space that is syntax, so a document
 * reading `\cb2\u212 ? ce nom` shows " ce nom" with a leading space -- the
 * escape separates `\cb2` from the text. Delete the escape and the result is
 * `\cb2 ce nom`, where that same space is now the delimiter and the leading
 * space is gone. Worse, `\qc\u212 ?abc` would become `\qcabc`, an entirely
 * different control word.
 *
 * So a cut that leaves a control word exposed puts a space back to delimit it.
 * That space is syntax, never content, and only where the word does not
 * already have one -- adding a second would be a leading space of its own.
 */
function endsWithControlWord(rtf: string, index: number): boolean {
  let i = index - 1;

  let digits = 0;
  while (i >= 0 && rtf[i] >= "0" && rtf[i] <= "9") {
    digits++;
    i--;
  }
  if (digits > 0 && i >= 0 && rtf[i] === "-") i--;

  let letters = 0;
  while (i >= 0 && /[a-zA-Z]/.test(rtf[i])) {
    letters++;
    i--;
  }
  if (letters === 0 || i < 0 || rtf[i] !== "\\") return false;

  // An even run of backslashes means the last is an escaped one -- literal
  // content, not the start of a control word.
  let run = 0;
  while (i - run >= 0 && rtf[i - run] === "\\") run++;
  return run % 2 === 1;
}

/**
 * Map cuts on a line's visible text onto ranges of the source document.
 *
 * Returns null when a cut cannot be expressed -- it would take part of an
 * indivisible unit, such as half of the `\u233 ?` that stands for one "é".
 * The caller's answer to that is to offer no fix rather than a doubtful one:
 * no offsets, no fix.
 */
export function cutsToEdits(
  rtf: string,
  line: RtfLine,
  cuts: readonly TextCut[]
): SourceEdit[] | null {
  const edits: SourceEdit[] = [];
  // Named for what it does rather than what it is, since `cut` is taken by
  // the loop below.
  const take = (start: number, end: number) =>
    edits.push(endsWithControlWord(rtf, start) ? { start, end, insert: " " } : { start, end });

  for (const cut of cuts) {
    if (cut.end <= cut.start) continue;
    if (cut.start < 0 || cut.end > line.text.length) return null;

    for (const span of line.spans) {
      const from = Math.max(cut.start, span.textStart);
      const to = Math.min(cut.end, span.textEnd);
      if (to <= from) continue;

      if (span.plain) {
        take(
          span.sourceStart + (from - span.textStart),
          span.sourceStart + (to - span.textStart)
        );
        continue;
      }

      // Indivisible: take all of it, or none of it and give up.
      if (from !== span.textStart || to !== span.textEnd) return null;
      take(span.sourceStart, span.sourceEnd);
    }
  }

  return edits;
}

/**
 * Apply edits to a document, leaving everything else byte for byte.
 *
 * Overlapping and touching ranges are merged rather than rejected: two checks
 * can legitimately want the same characters gone -- a trailing comma and the
 * trailing space behind it -- and that is agreement, not conflict. A merged
 * range keeps the replacement of the edit that starts it, since that is the
 * one whose left-hand join it inherits.
 */
export function applyEdits(rtf: string, edits: readonly SourceEdit[]): string {
  const ordered = [...edits]
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (ordered.length === 0) return rtf;

  let out = "";
  let cursor = 0;
  let { start: from, end: to, insert } = ordered[0];

  for (const edit of ordered.slice(1)) {
    if (edit.start <= to) {
      to = Math.max(to, edit.end);
      continue;
    }
    out += rtf.slice(cursor, from) + (insert ?? "");
    cursor = to;
    ({ start: from, end: to, insert } = edit);
  }

  out += rtf.slice(cursor, from) + (insert ?? "");
  return out + rtf.slice(to);
}

/**
 * Remove a whole line, formatting and terminating break included.
 *
 * Returns null for a line nothing terminated -- the last of a document, which
 * has no break to take with it, and which is never a gap between two others
 * anyway.
 */
export function lineEdit(rtf: string, line: RtfLine): SourceEdit | null {
  if (line.breakEnd === undefined) return null;
  const start = line.sourceStart;
  return endsWithControlWord(rtf, start)
    ? { start, end: line.breakEnd, insert: " " }
    : { start, end: line.breakEnd };
}

/**
 * The RTF payload of a text box, as characters.
 *
 * Latin-1 rather than UTF-8, so that every byte maps to exactly one character
 * and back: an RTF document spliced and re-encoded is identical to the original
 * wherever it was not edited, whatever the bytes happened to be. ProPresenter
 * escapes everything above ASCII as `\uNNN` anyway -- 15,930 text boxes across
 * 880 real files carry no byte above 0x7F -- so nothing is misread by it, and
 * the guarantee holds even for a file that does.
 */
export function decodeRtf(source: ArrayBufferView): string {
  // Normalised rather than assumed: the payload can arrive as any view of the
  // buffer, including one from another realm.
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  let out = "";
  // Chunked: spreading a large array into String.fromCharCode overflows the
  // argument limit on payloads a few hundred kilobytes long.
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/** The inverse of {@link decodeRtf}. */
export function encodeRtf(rtf: string): Uint8Array {
  const out = new Uint8Array(rtf.length);
  for (let i = 0; i < rtf.length; i++) out[i] = rtf.charCodeAt(i) & 0xff;
  return out;
}

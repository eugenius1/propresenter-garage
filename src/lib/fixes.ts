// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import {
  checkPresentation,
  checkPresentationFidelity,
  decodePresentation,
  encodePresentation,
  readPresentation,
  RUN_CLASS,
  SPACE_CLASS,
  writeTextBoxes,
  type PresentationDoc,
  type PresentationReport,
  type TextIssue,
  type TextIssueKind,
} from "./presentation";
import {
  applyEdits,
  cutsToEdits,
  lineEdit,
  type RtfLine,
  type SourceEdit,
  type TextCut,
} from "./rtf";

/**
 * Turning findings into edits.
 *
 * Everything here is a pure function from a decoded presentation to bytes, so
 * the whole write path can be exercised without a folder, a browser or a
 * reader's library. The interface's job is only to decide which fixes are
 * ticked; nothing below this line asks a question it cannot answer from the
 * file in front of it.
 *
 * Fixes are planned per *line*, not per finding. One line can carry three
 * findings at once -- a leading space, a doubled space and a trailing comma --
 * and showing three rows for one line would ask the reader to approve edits
 * that overlap each other. One row, one before, one after, one decision.
 */

// Built from the checker's own character classes, so a fix removes exactly
// what the check reported and never a character more.
const LEADING = new RegExp(`^${SPACE_CLASS}+`);
const TRAILING = new RegExp(`${SPACE_CLASS}+$`);
/** A run of two or more, with text on both sides of it. */
const RUN = new RegExp(`(?<=\\S)${RUN_CLASS}{2,}(?=\\S)`, "g");
/** The comma that ends a line, with whatever whitespace surrounds it. */
const COMMA = new RegExp(`${SPACE_CLASS}*,${SPACE_CLASS}*$`);

export interface LineFix {
  /** Which text box, as {@link TextBox.boxIndex} numbers them. */
  boxIndex: number;
  /** Which line within that box. */
  lineIndex: number;
  slideIndex: number;
  cueName: string;
  groupName?: string;
  /** Every kind this one edit settles, in the order they are reported. */
  kinds: TextIssueKind[];
  /** The line as it stands. */
  before: string;
  /** The line as it would read, or null when the line itself goes. */
  after: string | null;
  /** The splice that achieves it. */
  edits: SourceEdit[];
}

/** An address that names one line, for grouping findings and ticking boxes. */
export function fixKey(fix: { boxIndex: number; lineIndex: number }): string {
  return `${fix.boxIndex}:${fix.lineIndex}`;
}

/** The cuts that settle one kind of finding on one line, in text coordinates. */
function cutsFor(kind: TextIssueKind, text: string): TextCut[] {
  switch (kind) {
    case "leadingSpace": {
      const found = LEADING.exec(text);
      return found ? [{ start: 0, end: found[0].length }] : [];
    }
    case "trailingSpace": {
      const found = TRAILING.exec(text);
      return found ? [{ start: text.length - found[0].length, end: text.length }] : [];
    }
    case "repeatedSpace":
      // All of each run but one character, so two words stay two words. The
      // survivor is an ordinary space where the run holds one: a run written
      // as tab-then-space would otherwise collapse to the tab, which is the
      // same invisible oddity in a narrower form.
      return [...text.matchAll(RUN)].flatMap((m) => {
        const keep = m[0].includes(" ") ? m[0].indexOf(" ") : 0;
        return [
          { start: m.index, end: m.index + keep },
          { start: m.index + keep + 1, end: m.index + m[0].length },
        ];
      });
    case "trailingComma": {
      // The whitespace around it goes too. Otherwise "nom ," becomes "nom ",
      // trading one finding for another.
      const found = COMMA.exec(text);
      return found ? [{ start: text.length - found[0].length, end: text.length }] : [];
    }
    case "blankLine":
      // Handled as a whole-line removal; a blank line has no text to cut.
      return [];
  }
}

/** Apply cuts to a plain string, to show what the line would read. */
function preview(text: string, cuts: readonly TextCut[]): string {
  const ordered = [...cuts].sort((a, b) => b.start - a.start);
  let out = text;
  for (const cut of ordered) out = out.slice(0, cut.start) + out.slice(cut.end);
  return out;
}

/**
 * Work out what to do about the findings on one line.
 *
 * Returns null when the line cannot be fixed safely -- an edit that cannot be
 * expressed against the source, or a gap with no break to remove. No offsets,
 * no fix: an unfixable line stays reported and untouched rather than being
 * repaired approximately.
 */
function planLine(
  rtf: string,
  line: RtfLine,
  issues: readonly TextIssue[]
): LineFix | null {
  const first = issues[0];
  const kinds = issues.map((i) => i.kind);
  const site = {
    boxIndex: first.boxIndex,
    lineIndex: first.lineIndex,
    slideIndex: first.slideIndex,
    cueName: first.cueName,
    groupName: first.groupName,
    kinds,
  };

  if (kinds.includes("blankLine")) {
    // A blank line is removed outright: there is nothing on it to trim, and
    // leaving the paragraph behind is the problem being reported.
    const edit = lineEdit(rtf, line);
    return edit && { ...site, before: line.text, after: null, edits: [edit] };
  }

  const cuts = kinds.flatMap((kind) => cutsFor(kind, line.text));
  if (cuts.length === 0) return null;

  const edits = cutsToEdits(rtf, line, cuts);
  if (edits === null) return null;

  return { ...site, before: line.text, after: preview(line.text, cuts), edits };
}

/**
 * Plan a fix for every line the given findings touch.
 *
 * Takes findings rather than re-deriving them, so the interface's filters --
 * which checks are switched on, which pills are pressed -- decide what is
 * offered without this having to know about any of that.
 */
export function planFixes(doc: PresentationDoc, issues: readonly TextIssue[]): LineFix[] {
  const boxes = new Map(doc.textBoxes.map((box) => [box.boxIndex, box]));
  const byLine = new Map<string, TextIssue[]>();

  for (const issue of issues) {
    const key = fixKey(issue);
    const existing = byLine.get(key);
    if (existing) existing.push(issue);
    else byLine.set(key, [issue]);
  }

  const fixes: LineFix[] = [];
  for (const group of byLine.values()) {
    const box = boxes.get(group[0].boxIndex);
    const line = box?.lines[group[0].lineIndex];
    if (!box || !line) continue;
    const fix = planLine(box.rtf, line, group);
    if (fix) fixes.push(fix);
  }

  // Back into reading order, which is the order the findings were listed in.
  return fixes.sort((a, b) => a.boxIndex - b.boxIndex || a.lineIndex - b.lineIndex);
}

/** Why a file was not written. Carries a code; the interface supplies the words. */
export type FixRefusal = "lossy" | "unchanged" | "verifyFailed" | "unreadable" | "stale";

export class FixError extends Error {
  readonly reason: FixRefusal;

  constructor(reason: FixRefusal) {
    super(reason);
    this.name = "FixError";
    this.reason = reason;
  }
}

/**
 * Apply fixes to a file and hand back the bytes, or refuse.
 *
 * Four things have to hold before this returns anything, and every one is
 * checked against the file itself rather than assumed from the corpus:
 *
 * - the file survives a decode and re-encode with nothing lost, because
 *   protobuf.js drops fields the reverse-engineered schema does not declare;
 * - the edits actually change something;
 * - each line still reads what it read when the fix was planned, since the
 *   offsets a fix is built from describe the file as it was scanned and mean
 *   nothing against a file somebody has edited since;
 * - re-reading the result gives exactly the lines that were promised, every
 *   other line included.
 *
 * The last is the one that matters most. Everything upstream is tested, but a
 * file nobody has seen is still a file nobody has seen, and a wrong splice is
 * only cheap to discover here.
 */
export function applyFixes(bytes: Uint8Array, fixes: readonly LineFix[]): Uint8Array {
  if (fixes.length === 0) throw new FixError("unchanged");

  let doc;
  let before;
  try {
    if (!checkPresentationFidelity(bytes).exportSafe) throw new FixError("lossy");
    doc = decodePresentation(bytes);
    before = readPresentation(doc);
  } catch (e) {
    // A file that cannot be read cannot be repaired. It is already reported as
    // unreadable in the findings; this is the same answer on the way out.
    throw e instanceof FixError ? e : new FixError("unreadable");
  }

  const byBox = new Map<number, SourceEdit[]>();
  for (const fix of fixes) {
    // ProPresenter may have been open all along. A fix carries offsets into
    // the file as it was read, so a line that no longer says what it said is
    // a fix that no longer describes anything.
    const line = before.textBoxes.find((b) => b.boxIndex === fix.boxIndex)?.lines[fix.lineIndex];
    if (line?.text !== fix.before) throw new FixError("stale");

    const edits = byBox.get(fix.boxIndex);
    if (edits) edits.push(...fix.edits);
    else byBox.set(fix.boxIndex, [...fix.edits]);
  }

  const replacements = new Map<number, string>();
  for (const [boxIndex, edits] of byBox) {
    const box = before.textBoxes.find((b) => b.boxIndex === boxIndex)!;
    replacements.set(boxIndex, applyEdits(box.rtf, edits));
  }

  writeTextBoxes(doc, replacements);
  const written = encodePresentation(doc);

  verify(written, before, fixes);
  return written;
}

/** What every line of every edited box should read once the fixes are in. */
function expected(box: { lines: RtfLine[] }, fixes: readonly LineFix[]): string[] {
  const byLine = new Map(fixes.map((f) => [f.lineIndex, f]));
  return box.lines
    .map((line, index) => (byLine.has(index) ? byLine.get(index)!.after : line.text))
    .filter((text): text is string => text !== null);
}

function verify(written: Uint8Array, before: PresentationDoc, fixes: readonly LineFix[]): void {
  const after = readPresentation(decodePresentation(written));
  if (after.textBoxes.length !== before.textBoxes.length) throw new FixError("verifyFailed");

  for (const box of before.textBoxes) {
    const mine = fixes.filter((f) => f.boxIndex === box.boxIndex);
    const want = expected(box, mine);
    const got = after.textBoxes[box.boxIndex];

    // Untouched boxes are checked too: an edit must not reach past its own.
    if (got.lines.length !== want.length) throw new FixError("verifyFailed");
    if (got.lines.some((line, i) => line.text !== want[i])) throw new FixError("verifyFailed");
  }
}

/** The fixes chosen for one file, by its path within the folder. */
export interface FileFixPlan {
  path: string;
  fixes: LineFix[];
}

export interface FixOutcome {
  path: string;
  /** How many lines this file's fixes settle. */
  lines: number;
  /** The fixed file, when one could be produced. */
  bytes?: Uint8Array;
  /** Why it was refused or could not be saved, when it was. */
  reason?: FixRefusal | "writeFailed";
}

/**
 * Run a set of fixes over several files.
 *
 * Reading and writing are supplied rather than performed, so the whole run is
 * testable without a folder, and so the same code serves both routes: writing
 * back in Chromium, and building a zip of fixed copies everywhere else.
 *
 * One file's refusal does not stop the others. A library where a single
 * presentation cannot be read is the ordinary case, not the exceptional one,
 * and abandoning the other five hundred would be the wrong answer to it.
 */
export async function fixFiles(
  plans: readonly FileFixPlan[],
  read: (path: string) => Promise<Uint8Array>,
  write?: (path: string, bytes: Uint8Array) => Promise<void>
): Promise<FixOutcome[]> {
  const outcomes: FixOutcome[] = [];

  for (const plan of plans) {
    const lines = plan.fixes.length;
    let bytes: Uint8Array;

    try {
      bytes = applyFixes(await read(plan.path), plan.fixes);
    } catch (e) {
      outcomes.push({
        path: plan.path,
        lines,
        reason: e instanceof FixError ? e.reason : "unreadable",
      });
      continue;
    }

    if (write) {
      try {
        await write(plan.path, bytes);
      } catch {
        // The bytes were good; the folder would not take them. Permission can
        // lapse mid-run, and a file can be open elsewhere.
        outcomes.push({ path: plan.path, lines, reason: "writeFailed" });
        continue;
      }
    }

    outcomes.push({ path: plan.path, lines, bytes });
  }

  return outcomes;
}

export interface Examined {
  report: PresentationReport;
  /**
   * Just the text boxes carrying findings.
   *
   * Enough to plan any fix, and a fraction of the memory: a real library of
   * 880 presentations holds ten megabytes of RTF, of which the boxes with
   * something wrong in them are two. Keeping those means the reader can switch
   * a check on or off, or press a filter, and see the fixes change instantly
   * rather than waiting for the folder to be read again.
   */
  fixable: PresentationDoc;
}

/** Read a file, report on it, and keep what a fix would need. */
export function examine(filename: string, bytes: Uint8Array): Examined {
  let doc: PresentationDoc;
  let report: PresentationReport;

  try {
    doc = readPresentation(decodePresentation(bytes));
    report = checkPresentation(filename, doc);
  } catch (e) {
    return {
      report: {
        filename,
        name: filename,
        slideCount: 0,
        issues: [],
        emptyTextBoxes: 0,
        error: (e as Error).message,
      },
      fixable: { name: filename, slideCount: 0, textBoxes: [] },
    };
  }

  const wanted = new Set(report.issues.map((issue) => issue.boxIndex));
  return {
    report,
    fixable: { ...doc, textBoxes: doc.textBoxes.filter((box) => wanted.has(box.boxIndex)) },
  };
}

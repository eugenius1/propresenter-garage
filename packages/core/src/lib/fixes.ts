import {
  checkPresentation,
  checkPresentationFidelity,
  decodePresentation,
  encodePresentation,
  openPresentation,
  readPresentation,
  RUN_CLASS,
  SPACE_CLASS,
  TRAILING_PUNCTUATION,
  unreadableReport,
  writeTextBoxes,
  type PresentationDoc,
  type PresentationReport,
  type ReadProblem,
  type TextIssue,
  type TextIssueKind,
  type TrailingPunctuation,
} from "./presentation";
import {
  applyEdits,
  cutsToEdits,
  extractLines,
  hasLineControl,
  lineEdit,
  replaceLineText,
  type RtfLine,
  type SourceEdit,
  type TextCut,
} from "./rtf";
import { groupBy } from "./collections";

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
/**
 * The punctuation that ends a line, with whatever whitespace surrounds it.
 *
 * Built from the checker's own patterns, so the full stop that is not reported
 * at the end of "Gloire..." is not removed there either.
 */
const ENDING = Object.fromEntries(
  Object.entries(TRAILING_PUNCTUATION).map(([kind, mark]) => [
    kind,
    new RegExp(`${SPACE_CLASS}*${mark}${SPACE_CLASS}*$`),
  ])
) as Record<TrailingPunctuation, RegExp>;

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
  /**
   * The whole box's RTF as it was scanned, which the offsets in `edits` are
   * offsets into.
   */
  source: string;
}

/** Box by box, line by line: the order a slide is read in. */
function byReadingOrder(a: LineFix, b: LineFix): number {
  return a.boxIndex - b.boxIndex || a.lineIndex - b.lineIndex;
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
    case "blankLine":
      // Handled as a whole-line removal; a blank line has no text to cut.
      return [];
    default: {
      // The whitespace around it goes too. Otherwise "nom ," becomes "nom ",
      // trading one finding for another.
      const found = ENDING[kind].exec(text);
      return found ? [{ start: text.length - found[0].length, end: text.length }] : [];
    }
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
    source: rtf,
  };

  if (kinds.includes("blankLine")) {
    // A blank line is removed outright: there is nothing on it to trim, and
    // leaving the paragraph behind is the problem being reported.
    const edits = lineEdit(rtf, line);
    return edits && { ...site, before: line.text, after: null, edits };
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
  const fixes: LineFix[] = [];
  for (const group of groupBy(issues, fixKey).values()) {
    const box = boxes.get(group[0].boxIndex);
    const line = box?.lines[group[0].lineIndex];
    if (!box || !line) continue;
    const fix = planLine(box.rtf, line, group);
    if (fix) fixes.push(fix);
  }

  // Back into reading order, which is the order the findings were listed in.
  return fixes.sort(byReadingOrder);
}

/** One line as somebody wants it to read, by the address `readPresentation` gives it. */
export interface LineChange {
  boxIndex: number;
  lineIndex: number;
  /** What the line should read, on one line; null removes the line. */
  text: string | null;
}

/**
 * Why a requested change could not be planned.
 *
 * - `noSuchLine`: the file has no such box or line.
 * - `duplicate`: two changes name the same line.
 * - `unchanged`: the line already reads that.
 * - `notOneLine`: the text holds a line break or another control character.
 * - `lastLine`: removing the last line of a box, which has no break to take with it.
 * - `unsupported`: the change would not read back as asked once spliced --
 *   emptying a last line with nothing else on it, which reads as no line at
 *   all, or a box that is not an RTF document.
 */
export type EditRefusal = "noSuchLine" | "duplicate" | "unchanged" | "notOneLine" | "lastLine" | "unsupported";

export class EditError extends Error {
  readonly reason: EditRefusal;
  readonly change: LineChange;

  constructor(reason: EditRefusal, change: LineChange) {
    super(`${reason} at box ${change.boxIndex}, line ${change.lineIndex}`);
    this.name = "EditError";
    this.reason = reason;
    this.change = change;
  }
}

/**
 * Plan line changes asked for in words rather than found by a check.
 *
 * The result is the same `LineFix` the checks produce, so it goes through the
 * same `applyFixes` -- the same fidelity gate, the same staleness check and
 * the same read-back of every line in the file. There is one write path, and
 * this is a second way into it rather than a second path. It carries no
 * `kinds`: nothing was found, somebody asked.
 *
 * All or nothing: one change that cannot be planned refuses the lot, since a
 * half-applied set of edits to a song is worse than none.
 *
 * Each box is spliced and read back here too, with every planned change in
 * it, so a set of edits that would only fail `applyFixes`' read-back is
 * refused before anybody is asked to approve it rather than after.
 */
export function planLineEdits(doc: PresentationDoc, changes: readonly LineChange[]): LineFix[] {
  const boxes = new Map(doc.textBoxes.map((box) => [box.boxIndex, box]));
  const seen = new Set<string>();
  const fixes: LineFix[] = [];

  for (const change of changes) {
    const box = boxes.get(change.boxIndex);
    const line = box?.lines[change.lineIndex];
    if (!box || !line) throw new EditError("noSuchLine", change);
    const key = fixKey(change);
    if (seen.has(key)) throw new EditError("duplicate", change);
    seen.add(key);
    if (change.text === line.text) throw new EditError("unchanged", change);
    if (change.text !== null && hasLineControl(change.text)) throw new EditError("notOneLine", change);

    const edits =
      change.text === null ? lineEdit(box.rtf, line) : replaceLineText(box.rtf, line, change.text);
    if (edits === null) throw new EditError(change.text === null ? "lastLine" : "unsupported", change);

    fixes.push({
      boxIndex: box.boxIndex,
      lineIndex: line.index,
      slideIndex: box.slideIndex,
      cueName: box.cueName,
      groupName: box.groupName,
      kinds: [],
      before: line.text,
      after: change.text,
      edits,
      source: box.rtf,
    });
  }

  for (const box of doc.textBoxes) {
    const mine = fixes.filter((fix) => fix.boxIndex === box.boxIndex);
    if (mine.length === 0) continue;
    const got = extractLines(applyEdits(box.rtf, mine.flatMap((fix) => fix.edits))).map((line) => line.text);
    const want = expected(box, mine);
    if (got.length !== want.length || got.some((text, i) => text !== want[i])) {
      // Named by the box's first change: which of several broke it cannot be
      // told from the result.
      const [first] = mine;
      throw new EditError("unsupported", { boxIndex: first.boxIndex, lineIndex: first.lineIndex, text: first.after });
    }
  }

  return fixes.sort(byReadingOrder);
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
 * - each box still holds the source it held when the fix was planned, since
 *   the offsets a fix is built from describe the file as it was scanned and
 *   mean nothing against a file somebody has edited since;
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
    // the box as it was read, so a box that no longer holds that source is a
    // fix that no longer describes anything. The whole box, not just the line:
    // recolouring the line above shifts every offset below it while this
    // line's text reads exactly as it did.
    const box = before.textBoxes.find((b) => b.boxIndex === fix.boxIndex);
    if (box?.rtf !== fix.source || box.lines[fix.lineIndex]?.text !== fix.before) {
      throw new FixError("stale");
    }

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

/** How a run reaches the files, and what it reports back while it works. */
export interface FixRun {
  read: (path: string) => Promise<Uint8Array>;
  /** Absent when the fixed files are not going back into the folder. */
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
  /**
   * Called before each file, so a caller can say where it has got to.
   *
   * Before rather than after, because the interesting question during a long
   * run is which file is being worked on now, not which one has just finished.
   *
   * Awaited, so a caller in a browser can hand the main thread back and let
   * the report it just made actually reach the screen. Deciding what that is
   * worth is the caller's business; this only makes it possible.
   */
  onFile?: (path: string, done: number, total: number) => void | Promise<void>;
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
  { read, write, onFile }: FixRun
): Promise<FixOutcome[]> {
  const outcomes: FixOutcome[] = [];

  for (const [index, plan] of plans.entries()) {
    const lines = plan.fixes.length;
    let bytes: Uint8Array;

    await onFile?.(plan.path, index, plans.length);

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

/** A file that will not open: reported, with nothing to fix. */
export function unreadable(filename: string, problem: ReadProblem, detail?: string): Examined {
  return {
    report: unreadableReport(filename, problem, detail),
    fixable: { name: filename, slideCount: 0, textBoxes: [] },
  };
}

/** Read a file, report on it, and keep what a fix would need. */
export function examine(filename: string, bytes: Uint8Array): Examined {
  const opened = openPresentation(bytes);
  if (opened.problem) return unreadable(filename, opened.problem, opened.detail);

  const { doc } = opened;
  let report: PresentationReport;
  try {
    report = checkPresentation(filename, doc);
  } catch (e) {
    // A check tripping over one file's text marks that file, not the scan.
    return unreadable(filename, "unreadable", (e as Error).message);
  }
  const wanted = new Set(report.issues.map((issue) => issue.boxIndex));
  return {
    report,
    fixable: { ...doc, textBoxes: doc.textBoxes.filter((box) => wanted.has(box.boxIndex)) },
  };
}

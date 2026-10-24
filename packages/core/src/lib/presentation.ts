import { checkTypeFidelity, messageType, type FidelityReport, type RawDoc } from "./decode";
import { applicationInfo, basename } from "./model";
import { decodeRtf, encodeRtf, extractLines, type RtfLine } from "./rtf";

/**
 * Reading ProPresenter presentations (`.pro` files) and checking their text.
 *
 * A presentation is a different root message from a playlist -- `rv.data.
 * Presentation` rather than `rv.data.PlaylistDocument` -- but the same vendored
 * schema covers it, and real 21.4 files round-trip byte for byte.
 *
 * The checks here are about text hygiene rather than appearance: stray spaces
 * at the edges of a line, and lines that occupy space while showing nothing.
 * Both are invisible in ProPresenter's editor and obvious on a screen.
 */

const Presentation = messageType("rv.data.Presentation");

export interface TextBox {
  /**
   * Position of this box among every text box in the file.
   *
   * The address a fix is written back to. Walking the cues is deterministic,
   * so the same ordinal reaches the same box on a later pass -- and it keeps
   * the model free of protobuf objects, which the checking code has no
   * business holding on to.
   */
  boxIndex: number;
  /** Position of the slide within the presentation, zero-based. */
  slideIndex: number;
  /** The cue's own label, which ProPresenter often leaves as digits. */
  cueName: string;
  /** The arrangement group the slide belongs to, e.g. "Refrain". */
  groupName?: string;
  lines: RtfLine[];
  /**
   * The box's RTF document as characters.
   *
   * Kept because a fix is a splice of it: the extracted text is a projection
   * and cannot be written back.
   */
  rtf: string;
}

export interface PresentationDoc {
  name: string;
  slideCount: number;
  textBoxes: TextBox[];
}

export type TextIssueKind =
  | "leadingSpace"
  | "trailingSpace"
  | "blankLine"
  | "repeatedSpace"
  /**
   * A line whose visible text ends with punctuation that carries on.
   *
   * Reported like any other, but off by default in the interface: a comma or a
   * full stop at the end of a line is ordinary punctuation in prose, and only
   * looks wrong once lyrics are broken across slides. Whether it is a problem
   * is a matter of house style, so each is asked for rather than assumed --
   * and separately, since a house that strips commas may well keep the full
   * stop that ends a verse. In a real library of 24,181 lines, nearly a
   * thousand end with a full stop against 43 with a semicolon, which is the
   * difference between a habit and a slip.
   */
  | TrailingPunctuation;

export interface TextIssue {
  kind: TextIssueKind;
  /** Which text box this was found in -- see {@link TextBox.boxIndex}. */
  boxIndex: number;
  slideIndex: number;
  cueName: string;
  groupName?: string;
  /** Position of the line within its text box. */
  lineIndex: number;
  /** The line as it stands, untrimmed. */
  text: string;
}

export interface PresentationReport {
  /** File name as it sits on disk. */
  filename: string;
  name: string;
  slideCount: number;
  issues: TextIssue[];
  /**
   * Text boxes holding no visible text at all.
   *
   * Counted, not listed as issues. ProPresenter's themes leave empty
   * placeholder boxes on slides as a matter of course -- three real files
   * carried 77 of them between them -- so reporting each as a problem would
   * bury the handful of findings that matter.
   */
  emptyTextBoxes: number;
  /**
   * Set when the file could not be read at all.
   *
   * A code rather than a sentence, so the interface says it in the reader's
   * language -- and so the commonest cause can be named instead of handing
   * over the decoder's own words.
   */
  error?: ReadProblem;
  /** The decoder's own words, kept for the case nothing better can be said. */
  errorDetail?: string;
}

/**
 * Why a `.pro` file could not be read.
 *
 * `notPresentation` is worth separating from a decode failure because the
 * extension is shared: ChordPro chord charts are `.pro` files too, and one
 * turned up among 2,847 real ones. Told "invalid end group tag", a reader has
 * no way to know they are looking at a chord chart rather than a broken
 * presentation.
 */
export type ReadProblem = "empty" | "notPresentation" | "unreadable";

/**
 * Whether the bytes look like text rather than a protocol buffer.
 *
 * Two tests, because either alone is too easily fooled. Control characters
 * rule out most binary, but `3c ff fe` has none and is not text; valid UTF-8
 * rules out the rest, since stray high bytes are not a legal encoding of
 * anything. A character cut in half by the sample boundary would decode as a
 * replacement character, so the last few are not counted.
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 512);
  if (head.some((b) => b < 9 || (b > 13 && b < 32))) return false;

  const decoded = new TextDecoder("utf-8").decode(head);
  const whole = head.length < bytes.length ? decoded.slice(0, -2) : decoded;
  return !whole.includes("\ufffd");
}

/**
 * Classify a file that could not be read as a presentation.
 *
 * Empty is checked by the caller rather than here, because an empty file
 * decodes perfectly well -- as a presentation with nothing in it.
 */
export function readProblem(bytes: Uint8Array): ReadProblem {
  if (bytes.length === 0) return "empty";
  return looksLikeText(bytes) ? "notPresentation" : "unreadable";
}

export function decodePresentation(bytes: Uint8Array): RawDoc {
  return Presentation.decode(bytes) as RawDoc;
}

/** A presentation read from bytes, or why it could not be. */
export type Opened =
  | { doc: PresentationDoc; raw: RawDoc; problem?: undefined }
  | { problem: ReadProblem; detail?: string; doc?: undefined };

/**
 * Read a presentation's text, or classify why not.
 *
 * Emptiness is checked before decoding, because nothing goes wrong decoding
 * no bytes: protobuf reads them as a presentation with nothing in it, and the
 * reader would be told about a song with no slides rather than about a file
 * with no content.
 */
export function openPresentation(bytes: Uint8Array): Opened {
  if (bytes.length === 0) return { problem: "empty" };
  try {
    const raw = decodePresentation(bytes);
    return { doc: readPresentation(raw), raw };
  } catch (e) {
    return { problem: readProblem(bytes), detail: (e as Error).message };
  }
}

export function encodePresentation(doc: RawDoc): Uint8Array {
  return Presentation.encode(doc).finish();
}

/** Where one text box lives, as the walk below reports it. */
interface TextBoxSite {
  boxIndex: number;
  slideIndex: number;
  cueName: string;
  groupName?: string;
  /** The message holding the payload, so a caller can replace it. */
  text: { rtf_data: Uint8Array };
}

/**
 * Visit every text box in the file, in a fixed order.
 *
 * One walk serving both reading and writing, on purpose. `boxIndex` is the
 * address a fix is written back to, so if the reader and the writer disagreed
 * about the order -- even in some corner neither was thought about -- a fix
 * would land in the wrong box. Sharing the traversal makes that impossible
 * rather than merely unlikely.
 */
function eachTextBox(doc: RawDoc, visit: (site: TextBoxSite) => void): number {
  const raw = doc as any;

  // Cues carry the slides; groups name the sections and reference cues by uuid.
  const groupByCue = new Map<string, string>();
  for (const entry of raw.cue_groups ?? []) {
    const name: string = entry.group?.name ?? "";
    for (const id of entry.cue_identifiers ?? []) {
      if (id?.string) groupByCue.set(id.string, name);
    }
  }

  const cues: any[] = raw.cues ?? [];
  let boxIndex = 0;

  cues.forEach((cue, slideIndex) => {
    const cueName: string = cue.name ?? "";
    const groupName = groupByCue.get(cue.uuid?.string ?? "");

    for (const action of cue.actions ?? []) {
      const elements = action.slide?.presentation?.base_slide?.elements ?? [];
      for (const wrapper of elements) {
        const text = wrapper?.element?.text;
        // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: the array
        // protobuf.js hands back can come from a different realm than the one
        // this code runs in, and `instanceof` answers no across that boundary.
        // The symptom is a file that decodes cleanly and reports no text at
        // all, which is indistinguishable from a presentation with none.
        if (!ArrayBuffer.isView(text?.rtf_data)) continue;
        visit({
          boxIndex: boxIndex++,
          slideIndex,
          cueName,
          groupName: groupName || undefined,
          text: text as { rtf_data: Uint8Array },
        });
      }
    }
  });

  return cues.length;
}

/** Walk the presentation into the text boxes it actually renders. */
export function readPresentation(doc: RawDoc): PresentationDoc {
  const textBoxes: TextBox[] = [];

  const slideCount = eachTextBox(doc, (site) => {
    const rtf = decodeRtf(site.text.rtf_data);
    textBoxes.push({
      boxIndex: site.boxIndex,
      slideIndex: site.slideIndex,
      cueName: site.cueName,
      groupName: site.groupName,
      lines: extractLines(rtf),
      rtf,
    });
  });

  return { name: (doc as any).name ?? "", slideCount, textBoxes };
}

/**
 * What a presentation says about itself, beyond its slides.
 *
 * Every field comes from inside the file, so it survives copying, syncing and
 * restoring from backup. That is the point of reading these rather than the
 * file system: ProPresenter keeps its own record of when a presentation was
 * last edited and last shown, and a copy carries it along.
 *
 * There is deliberately no creation date. The file has no field for one, and
 * the file system's is reset by every copy, sync or restore -- a library moved
 * to a new computer would report every song as created that day.
 */
export interface PresentationDetails {
  /**
   * When ProPresenter last saved an edit to it, as ISO 8601.
   *
   * Checked against Windows on real 21.4 files: it matched the file system's
   * modification time to the minute, and unlike that time it survived a
   * round trip through a Google Drive backup.
   */
  lastModified?: string;
  /** When it was last shown on screen, as ISO 8601. Absent if never. */
  lastUsed?: string;
  category?: string;
  notes?: string;
  ccli?: {
    songTitle?: string;
    author?: string;
    artistCredits?: string;
    publisher?: string;
    copyrightYear?: number;
    songNumber?: number;
    album?: string;
  };
  musicKey?: { original?: string; user?: string };
  /**
   * Each named order of the song's groups, by group name; `null` for an id
   * that names no group in the file.
   *
   * Which one is selected is not reported: in real 21.4 files the
   * `selected_arrangement` id matched none of the file's arrangements, so
   * what it points at is not understood well enough to pass on.
   */
  arrangements: { name: string; groups: (string | null)[] }[];
  /** The ProPresenter that last saved the file, reported as the media bin's is. */
  savedBy?: { appVersion: string; platform: string };
}

/** `rv.data.Timestamp` as ISO 8601, or nothing for an unset one. */
function isoTimestamp(ts: any): string | undefined {
  // int64 arrives as a protobuf.js Long; Number() covers both forms.
  const seconds = Number(ts?.seconds ?? 0);
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000 + Math.floor((ts.nanos ?? 0) / 1e6));
  // A corrupt or absurd value is no date at all, not a reason to fail the read:
  // toISOString() throws on anything outside the range Date can hold.
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Keep only the fields that hold something, so an empty CCLI reads as absent. */
function present<T extends object>(fields: T): Partial<T> | undefined {
  const kept = Object.entries(fields).filter(([, v]) => v !== undefined && v !== "" && v !== 0);
  return kept.length ? (Object.fromEntries(kept) as Partial<T>) : undefined;
}

export function readDetails(doc: RawDoc): PresentationDetails {
  const raw = doc as any;

  const groupNames = new Map<string, string>();
  for (const entry of raw.cue_groups ?? []) {
    if (entry.group?.uuid?.string) groupNames.set(entry.group.uuid.string, entry.group.name ?? "");
  }
  const music = raw.music ?? {};
  return {
    lastModified: isoTimestamp(raw.last_modified_date),
    lastUsed: isoTimestamp(raw.last_date_used),
    category: raw.category || undefined,
    notes: raw.notes || undefined,
    ccli: raw.ccli
      ? present({
          songTitle: raw.ccli.song_title,
          author: raw.ccli.author,
          artistCredits: raw.ccli.artist_credits,
          publisher: raw.ccli.publisher,
          copyrightYear: raw.ccli.copyright_year,
          songNumber: raw.ccli.song_number,
          album: raw.ccli.album,
        })
      : undefined,
    musicKey: present({
      original: music.original_music_key || raw.music_key || undefined,
      user: music.user_music_key || undefined,
    }),
    arrangements: (raw.arrangements ?? []).map((a: any) => ({
      name: a.name ?? "",
      groups: (a.group_identifiers ?? []).map((id: any) => groupNames.get(id?.string) ?? null),
    })),
    savedBy: raw.application_info ? applicationInfo(raw.application_info) : undefined,
  };
}

/**
 * Replace the RTF of the named boxes, leaving every other field untouched.
 *
 * Edits the decoded message rather than rebuilding it: the model above is a
 * projection of what the checks need, and regenerating a file from it would
 * discard everything ProPresenter writes that this app does not read.
 */
export function writeTextBoxes(doc: RawDoc, replacements: ReadonlyMap<number, string>): void {
  eachTextBox(doc, (site) => {
    const replacement = replacements.get(site.boxIndex);
    if (replacement !== undefined) site.text.rtf_data = encodeRtf(replacement);
  });
}

/**
 * Whether a box shows anything at all.
 *
 * A box that does not is a theme placeholder: counted, never reported, and
 * the same answer wherever it is asked.
 */
export function hasText(box: Pick<TextBox, "lines">): boolean {
  return box.lines.some((line) => line.text.trim() !== "");
}

/**
 * Whitespace that shows as a gap: ordinary spaces, tabs, non-breaking spaces.
 *
 * Exported as a pattern rather than only as the regular expressions built from
 * it, so that what a fix removes is defined in exactly one place as what a
 * check reports. The two drifting apart would mean a preview promising one
 * thing and an edit doing another.
 */
export const SPACE_CLASS = "[ \\t\\u00a0\\u202f\\u2007]";

/**
 * The narrower class the doubled-space check looks in: spaces and tabs only.
 *
 * Two non-breaking spaces in a row are deliberate far more often than they are
 * a slip -- they are how someone forces a gap that centring would otherwise
 * close -- so they are left alone.
 */
export const RUN_CLASS = "[ \\t]";

const LEADING_SPACE = new RegExp(`^${SPACE_CLASS}`);
const TRAILING_SPACE = new RegExp(`${SPACE_CLASS}$`);
const REPEATED_SPACE = new RegExp(`\\S${RUN_CLASS}{2,}\\S`);
/**
 * Punctuation a line ends with.
 *
 * Trailing whitespace is allowed for rather than required, so "nom," and
 * "nom, " are the same finding -- and so is "nom ,", since a space before the
 * comma does not change what the line ends with. Any stray space is still
 * reported separately by the checks above.
 */
export type TrailingPunctuation = "trailingComma" | "trailingSemicolon" | "trailingFullStop";

/**
 * What each trailing-punctuation check looks for, as a pattern rather than a
 * finished expression.
 *
 * Exported in this form so the check and the fix are built from one
 * definition: the check anchors it to the end of a line, the fix takes the
 * whitespace around it too, and neither can drift from the other.
 */
export const TRAILING_PUNCTUATION: Record<TrailingPunctuation, string> = {
  trailingComma: ",",
  trailingSemicolon: ";",
  /**
   * A single full stop, and deliberately not an ellipsis.
   *
   * "Gloire..." and "Gloire\u2026" are a line running on into the next slide,
   * which is the opposite of the thing being reported -- 30 of them in a real
   * library of 24,181 lines. The lookbehind is what separates the two: the
   * last stop of "..." has another before it, so it never matches.
   */
  trailingFullStop: "(?<![.\\u2026])\\.",
};

const ENDS_WITH = Object.fromEntries(
  Object.entries(TRAILING_PUNCTUATION).map(([kind, mark]) => [
    kind,
    new RegExp(`${mark}${SPACE_CLASS}*$`),
  ])
) as Record<TrailingPunctuation, RegExp>;

/**
 * Check one presentation's text.
 *
 * A blank line is only reported when it sits between lines that do have text.
 * A box that is blank throughout is an unused placeholder, not a gap in a
 * slide, and there are far more of those than there are real findings.
 */
export function checkPresentation(
  filename: string,
  doc: PresentationDoc
): PresentationReport {
  const issues: TextIssue[] = [];
  let emptyTextBoxes = 0;

  for (const box of doc.textBoxes) {
    if (!hasText(box)) {
      emptyTextBoxes++;
      continue;
    }

    const firstReal = box.lines.findIndex((line) => line.text.trim() !== "");
    const lastReal =
      box.lines.length - 1 - [...box.lines].reverse().findIndex((l) => l.text.trim() !== "");

    const at = (kind: TextIssueKind, line: RtfLine): TextIssue => ({
      kind,
      boxIndex: box.boxIndex,
      slideIndex: box.slideIndex,
      cueName: box.cueName,
      groupName: box.groupName,
      lineIndex: line.index,
      text: line.text,
    });

    box.lines.forEach((line, i) => {
      if (line.text.trim() === "") {
        // Only a gap once there is text on both sides of it. A blank line
        // before the first or after the last is padding, not a hole.
        if (i > firstReal && i < lastReal) issues.push(at("blankLine", line));
        return;
      }
      if (LEADING_SPACE.test(line.text)) issues.push(at("leadingSpace", line));
      if (TRAILING_SPACE.test(line.text)) issues.push(at("trailingSpace", line));
      if (REPEATED_SPACE.test(line.text)) issues.push(at("repeatedSpace", line));
      for (const kind of Object.keys(ENDS_WITH) as TrailingPunctuation[]) {
        if (ENDS_WITH[kind].test(line.text)) issues.push(at(kind, line));
      }
    });
  }

  return {
    filename,
    name: doc.name,
    slideCount: doc.slideCount,
    issues,
    emptyTextBoxes,
  };
}

/** A report for a file that could not be read at all. */
export function unreadableReport(
  filename: string,
  problem: ReadProblem,
  detail?: string
): PresentationReport {
  return {
    filename,
    name: basename(filename),
    slideCount: 0,
    issues: [],
    emptyTextBoxes: 0,
    error: problem,
    errorDetail: detail,
  };
}

/**
 * Whether this presentation survives being written back out.
 *
 * The same gate the playlist tools use, against `rv.data.Presentation`. Every
 * real 21.4 file checked so far comes back `identical`, which is what makes a
 * write path viable -- but the schema is reverse-engineered, so the file in
 * front of the reader is checked rather than the corpus being taken as proof.
 */
export function checkPresentationFidelity(bytes: Uint8Array): FidelityReport {
  return checkTypeFidelity(Presentation, bytes);
}

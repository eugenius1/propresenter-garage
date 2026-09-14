// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { checkTypeFidelity, messageType, type FidelityReport, type RawDoc } from "./decode";
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
   * A line whose visible text ends with a comma.
   *
   * Reported like any other, but off by default in the interface: a comma at
   * the end of a line is ordinary punctuation in prose and only looks wrong
   * once lyrics are broken across slides. Whether it is a problem is a matter
   * of house style, so it is asked for rather than assumed.
   */
  | "trailingComma";

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
  /** Set when the file could not be read at all. */
  error?: string;
}

export function decodePresentation(bytes: Uint8Array): RawDoc {
  return Presentation.decode(bytes) as RawDoc;
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

const EDGE_SPACE = new RegExp(`^${SPACE_CLASS}|${SPACE_CLASS}$`);
const LEADING_SPACE = new RegExp(`^${SPACE_CLASS}`);
const TRAILING_SPACE = new RegExp(`${SPACE_CLASS}$`);
const REPEATED_SPACE = new RegExp(`\\S${RUN_CLASS}{2,}\\S`);
/**
 * A line whose visible text ends with a comma.
 *
 * Trailing whitespace is allowed for rather than required, so "nom," and
 * "nom, " are the same finding -- and so is "nom ,", since a space before
 * the comma does not change what the line ends with. Any stray space is
 * still reported separately by the checks above.
 */
const TRAILING_COMMA = new RegExp(`,${SPACE_CLASS}*$`);

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
    const hasText = box.lines.some((line) => line.text.trim() !== "");
    if (!hasText) {
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
      if (TRAILING_COMMA.test(line.text)) issues.push(at("trailingComma", line));
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

/** Decode, read and check a file in one step. */
export function checkPresentationFile(
  filename: string,
  bytes: Uint8Array
): PresentationReport {
  try {
    return checkPresentation(filename, readPresentation(decodePresentation(bytes)));
  } catch (e) {
    return {
      filename,
      name: filename,
      slideCount: 0,
      issues: [],
      emptyTextBoxes: 0,
      error: (e as Error).message,
    };
  }
}

export function hasEdgeSpace(line: string): boolean {
  return EDGE_SPACE.test(line);
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

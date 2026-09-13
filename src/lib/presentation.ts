// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { messageType, type RawDoc } from "./decode";
import { extractLines, type RtfLine } from "./rtf";

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
  /** Position of the slide within the presentation, zero-based. */
  slideIndex: number;
  /** The cue's own label, which ProPresenter often leaves as digits. */
  cueName: string;
  /** The arrangement group the slide belongs to, e.g. "Refrain". */
  groupName?: string;
  lines: RtfLine[];
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

/** Walk the presentation into the text boxes it actually renders. */
export function readPresentation(doc: RawDoc): PresentationDoc {
  const raw = doc as any;

  // Cues carry the slides; groups name the sections and reference cues by uuid.
  const groupByCue = new Map<string, string>();
  for (const entry of raw.cue_groups ?? []) {
    const name: string = entry.group?.name ?? "";
    for (const id of entry.cue_identifiers ?? []) {
      if (id?.string) groupByCue.set(id.string, name);
    }
  }

  const textBoxes: TextBox[] = [];
  const cues: any[] = raw.cues ?? [];

  cues.forEach((cue, slideIndex) => {
    const cueName: string = cue.name ?? "";
    const groupName = groupByCue.get(cue.uuid?.string ?? "");

    for (const action of cue.actions ?? []) {
      const elements = action.slide?.presentation?.base_slide?.elements ?? [];
      for (const wrapper of elements) {
        const rtf = wrapper?.element?.text?.rtf_data;
        if (!(rtf instanceof Uint8Array)) continue;
        textBoxes.push({
          slideIndex,
          cueName,
          groupName: groupName || undefined,
          lines: extractLines(new TextDecoder().decode(rtf)),
        });
      }
    }
  });

  return { name: raw.name ?? "", slideCount: cues.length, textBoxes };
}

/** Whitespace that shows as a gap: ordinary spaces, tabs, non-breaking spaces. */
const EDGE_SPACE = /^[ \t   ]|[ \t   ]$/;
const LEADING_SPACE = /^[ \t   ]/;
const TRAILING_SPACE = /[ \t   ]$/;
const REPEATED_SPACE = /\S[ \t]{2,}\S/;
/**
 * A line whose visible text ends with a comma.
 *
 * Trailing whitespace is allowed for rather than required, so "nom," and
 * "nom, " are the same finding -- and so is "nom ,", since a space before
 * the comma does not change what the line ends with. Any stray space is
 * still reported separately by the checks above.
 */
const TRAILING_COMMA = /,[ \t   ]*$/;

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

/** Trim the edges of every line in an RTF document, leaving formatting alone. */
export function hasEdgeSpace(line: string): boolean {
  return EDGE_SPACE.test(line);
}

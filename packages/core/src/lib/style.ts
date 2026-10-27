import {
  canonicalObject,
  checkTypeFidelity,
  messageType,
  newUuid,
  wireCopy,
  type RawDoc,
} from "./decode";
import {
  checkPresentationFidelity,
  decodePresentation,
  encodePresentation,
  shownBounds,
  slidesInOrder,
} from "./presentation";
import { decodeRtf, encodeRtf, endsWithControlWord, extractLines } from "./rtf";

/**
 * Giving one presentation's slides the look of another's.
 *
 * What ProPresenter calls applying a theme slide: the target slide's elements
 * are replaced by the style slide's, and the target's words are poured into
 * the style's text boxes. Nothing in the file records which style a slide came
 * from -- there is no back-reference to a theme -- so applying one is exactly
 * that replacement and nothing more.
 *
 * The words are what must survive. A style slide's RTF carries its own sample
 * text ("You called my name", or another song's chorus), so the new box is the
 * style's RTF with that text spliced out and the target's spliced in, leaving
 * the font table, colours and paragraph settings around it untouched. The
 * result is then read back, and a slide whose words come back different from
 * what it said before is refused rather than written.
 *
 * Nothing here writes a file. {@link applyStyle} returns bytes, and the caller
 * saves them as a copy: this is not one of the in-place write paths AGENTS.md
 * allows, and does not try to become one.
 */

const Presentation = messageType("rv.data.Presentation");
const ThemeDocument = messageType("rv.data.Template.Document");
const Slide = messageType("rv.data.Slide");
const Cue = messageType("rv.data.Cue");
const CustomAttribute = messageType("rv.data.Graphics.Text.Attributes.CustomAttribute");
const IntRange = messageType("rv.data.IntRange");

/** `Slide.Element.Info.INFO_IS_TEXT_ELEMENT`: the boxes that take words. */
const TEXT_ELEMENT = 2;

/** A slide whose look is to be copied. */
export interface SlideStyle {
  /** Where it came from, for the reader: a theme slide's name, or a cue label. */
  name: string;
  /** The `rv.data.Slide` to copy, decoded. Never edited. */
  baseSlide: any;
}

export type StyleErrorCode =
  | "lossy"
  | "noSuchSlide"
  | "noTextBox"
  | "verifyFailed";

export class StyleError extends Error {
  readonly code: StyleErrorCode;
  readonly params: Record<string, string>;

  constructor(code: StyleErrorCode, params: Record<string, string> = {}) {
    super(`${code} ${JSON.stringify(params)}`);
    this.name = "StyleError";
    this.code = code;
    this.params = params;
  }
}

/**
 * The slide styles a ProPresenter theme offers, in its own order.
 *
 * A theme is a `Template.Document` of its own, saved as `Themes/<name>/Theme`.
 * Gated like any other read that will be copied from: a field the schema
 * drops would vanish from every slide the style is applied to.
 */
export function themeStyles(bytes: Uint8Array): SlideStyle[] {
  if (!checkTypeFidelity(ThemeDocument, bytes).exportSafe) throw new StyleError("lossy");
  const doc = ThemeDocument.decode(bytes) as any;
  return (doc.slides ?? []).map((slide: any, i: number) => ({
    name: slide.name || String(i + 1),
    baseSlide: slide.base_slide ?? {},
  }));
}

/**
 * The style of one slide of an existing presentation.
 *
 * `slideIndex` counts as ProPresenter numbers slides -- see
 * {@link slidesInOrder} -- so slide 2 on screen is index 1 here.
 */
export function presentationStyle(bytes: Uint8Array, slideIndex: number): SlideStyle {
  if (!checkPresentationFidelity(bytes).exportSafe) throw new StyleError("lossy");
  const doc = decodePresentation(bytes);
  const slide = slidesInOrder(doc)[slideIndex];
  const baseSlide = slide && slideOf(slide.cue)?.base_slide;
  if (!baseSlide) throw new StyleError("noSuchSlide", { slide: String(slideIndex + 1) });
  return { name: `${(doc as any).name ?? ""} ${slideIndex + 1}`.trim(), baseSlide };
}

export interface StyleOptions {
  /** Slides to leave alone, as ProPresenter numbers them from zero. */
  skipSlides?: readonly number[];
  /** Leave alone any slide that triggers one of these macros. */
  skipMacros?: readonly string[];
  /**
   * Leave alone a slide whose macro is not the one most slides use.
   *
   * On by default. A song's title slide is laid out differently from its
   * lyrics -- title and authors in two boxes, often over artwork -- and
   * restyling it as a lyric slide is never what was meant. In a real library
   * those slides were the ones carrying a different macro ("Bienvenue" where
   * every lyric slide carried "Louange"), which is a better signal than
   * position: not every song opens with one. A slide with no macro at all is
   * not set apart by this.
   */
  skipDistinctMacro?: boolean;
  /**
   * Restyle a slide even when it holds elements besides its words.
   *
   * Off by default. Applying a style replaces every element on the slide, so
   * an image or a shape the slide carried of its own would go with no word
   * of it in the words that are checked afterwards. Such a slide is left
   * alone unless losing them is asked for.
   */
  replaceOtherElements?: boolean;
}

export type SkipReason =
  | "listed"
  | "macro"
  | "distinctMacro"
  | "otherElements"
  | "moreTextThanStyle"
  | "notASlide";

export interface SlidePlan {
  slideIndex: number;
  cueName: string;
  groupName?: string;
  macros: string[];
  /** Why it is left alone, when it is. */
  skip?: SkipReason;
  /**
   * The lines of each box that holds any text, in order.
   *
   * What the slide will say afterwards, line for line -- and what it is
   * checked against once it has been rebuilt.
   */
  textBoxes: string[][];
}

/** The macros a cue triggers, by name. */
function macroNames(cue: any): string[] {
  return (cue.actions ?? [])
    .filter((a: any) => a.macro)
    .map((a: any) => a.macro.identification?.parameter_name || a.name || "");
}

function slideOf(cue: any): any {
  return (cue.actions ?? []).find((a: any) => a.slide?.presentation)?.slide.presentation;
}

/** The macro on the most slides, when one clearly is. */
function commonestMacro(macrosBySlide: string[][]): string | undefined {
  const counts = new Map<string, number>();
  for (const names of macrosBySlide) {
    for (const name of new Set(names)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  // A tie is no rule at all: two macros on two slides says nothing about
  // which of them is the title.
  if (ranked.length === 0 || ranked[1]?.[1] === ranked[0][1]) return undefined;
  return ranked[0][0];
}

function isTextElement(wrapper: any): boolean {
  return ((wrapper.info ?? 0) & TEXT_ELEMENT) !== 0 && ArrayBuffer.isView(wrapper.element?.text?.rtf_data);
}

/**
 * The lines a box shows, without the blank padding above and below.
 *
 * Padding is layout, and the layout is what is being replaced: a box that
 * centred two lines by adding a blank one above them would drag that blank
 * into a style that centres by itself. A blank between two lines is kept.
 */
function linesOf(wrapper: any): string[] {
  const lines = extractLines(decodeRtf(wrapper.element.text.rtf_data)).map((l) => l.text);
  const [first, last] = shownBounds(lines);
  return lines.slice(first, last + 1);
}

const hasRtf = (wrapper: any) => ArrayBuffer.isView(wrapper.element?.text?.rtf_data);

/**
 * The lines on a slide, box by box.
 *
 * Read from any box with text, marked as a text element or not, so that no
 * words are left behind. A restyled slide is read back through the style's
 * own text elements only, since that is where they were put: a theme's shape
 * can carry decorative text of its own that is not anybody's lyrics.
 */
function textBoxesOf(slide: any, textElementsOnly = false): string[][] {
  return (slide.base_slide?.elements ?? [])
    .filter(textElementsOnly ? isTextElement : hasRtf)
    .map(linesOf)
    .filter((lines: string[]) => lines.length > 0);
}

/**
 * Elements on a slide that show something other than its words.
 *
 * An image or a video, which has no text at all, and a shape, which
 * ProPresenter marks with info but not as a text element. An empty text box
 * is neither: themes leave them as placeholders, and nothing of it shows.
 */
function otherElements(slide: any): number {
  return (slide.base_slide?.elements ?? []).filter((w: any) => {
    if (!hasRtf(w)) return true;
    const marked = (w.info ?? 0) !== 0;
    return marked && !isTextElement(w) && linesOf(w).length === 0;
  }).length;
}

/** How many text boxes a style has to put words in. */
export function styleSlots(style: SlideStyle): number {
  return (style.baseSlide.elements ?? []).filter(isTextElement).length;
}

/** What applying `style` would do to each slide, without doing it. */
export function planStyle(doc: RawDoc, style: SlideStyle, options: StyleOptions = {}): SlidePlan[] {
  const slots = styleSlots(style);
  if (slots === 0) throw new StyleError("noTextBox", { style: style.name });

  const slides = slidesInOrder(doc);
  const macros = slides.map(({ cue }) => macroNames(cue));
  const commonest =
    options.skipDistinctMacro === false ? undefined : commonestMacro(macros);
  const listed = new Set(options.skipSlides ?? []);
  const skipMacros = new Set(options.skipMacros ?? []);

  return slides.map(({ cue, groupName }, slideIndex) => {
    const slide = slideOf(cue);
    const textBoxes = slide ? textBoxesOf(slide) : [];
    const names = macros[slideIndex];

    let skip: SkipReason | undefined;
    if (!slide) skip = "notASlide";
    else if (listed.has(slideIndex)) skip = "listed";
    else if (names.some((n) => skipMacros.has(n))) skip = "macro";
    // Set apart by carrying another macro *instead of* the usual one: a lyric
    // slide that also fires a lighting cue still carries "Louange".
    else if (commonest && names.length > 0 && !names.includes(commonest)) skip = "distinctMacro";
    else if (!options.replaceOtherElements && otherElements(slide) > 0) skip = "otherElements";
    // Words with nowhere to go would be lost, which is the one thing this
    // must never do.
    else if (textBoxes.length > slots) skip = "moreTextThanStyle";

    return { slideIndex, cueName: cue.name ?? "", groupName, macros: names, skip, textBoxes };
  });
}

/** Escape text for an RTF body. `\uN ?` for anything beyond ASCII. */
function escapeRtf(text: string, fallback: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (ch === "\t") out += "\\tab ";
    else if (ch >= " " && ch <= "~") out += ch;
    else {
      // One escape per UTF-16 unit, signed, as RTF counts them.
      for (let i = 0; i < ch.length; i++) {
        const unit = ch.charCodeAt(i);
        out += `\\u${unit > 0x7fff ? unit - 0x10000 : unit} ${fallback}`;
      }
    }
  }
  return out;
}

/**
 * The style's RTF with its own words replaced by `lines`.
 *
 * Everything before the style's first visible character and after its last is
 * kept as it is -- that is where the fonts, colours and paragraph settings
 * live. Between lines goes whatever the style itself puts between its first
 * two, so a box whose second paragraph is formatted like its first carries
 * that on to every line.
 */
export function restyleRtf(styleRtf: string, lines: readonly string[]): string {
  const styleLines = extractLines(styleRtf);
  const shown = styleLines.filter((l) => l.spans.length > 0);

  let start: number;
  let end: number;
  let separator: string | undefined;
  if (shown.length > 0) {
    const first = shown[0];
    start = first.spans[0].sourceStart;
    end = shown.at(-1)!.spans.at(-1)!.sourceEnd;
    const next = styleLines[first.index + 1];
    if (first.breakStart !== undefined && next) {
      separator = styleRtf.slice(first.breakStart, next.spans[0]?.sourceStart ?? next.sourceEnd);
    }
  } else {
    // A box with no words of its own: write them where the document closes,
    // inside its outermost group, so they inherit everything it sets.
    start = end = styleRtf.lastIndexOf("}");
  }
  separator ??= styleRtf.includes("\\cocoartf") ? "\\\n" : "\\par ";

  const before = styleRtf.slice(0, start);
  // `\ucN` says how many fallback characters follow each escape, and a
  // reader skips exactly that many: one "?" too few eats a letter, one too
  // many shows. RTF's own default is one.
  const declared = [...before.matchAll(/\\uc(\d+)/g)].at(-1)?.[1];
  const fallback = "?".repeat(declared === undefined ? 1 : Number(declared));

  let body = "";
  lines.forEach((line, i) => {
    if (i > 0) body += separator;
    const text = escapeRtf(line, fallback);
    // A control word with nothing after it would swallow the first letter.
    // Only the tail matters, and it lies in `body` once there is one.
    const tail = body || before;
    body += text && endsWithControlWord(tail, tail.length) ? ` ${text}` : text;
  });

  // The sample can straddle groups -- `{\b Gloire} nom` -- and cutting it
  // out takes a brace with it. Put back whatever the cut unbalanced.
  const depth = groupDepth(styleRtf.slice(start, end));
  const rebalance = depth < 0 ? "}".repeat(-depth) : "{".repeat(depth);
  return before + body + rebalance + styleRtf.slice(end);
}

/** Groups opened minus groups closed, ignoring escaped braces. */
function groupDepth(rtf: string): number {
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    if (rtf[i] === "\\") i++;
    else if (rtf[i] === "{") depth++;
    else if (rtf[i] === "}") depth--;
  }
  return depth;
}

/**
 * What a style box's per-range attributes become once the words change.
 *
 * A style's `custom_attributes` are ranges over its own sample text. One that
 * covered all of it -- "Your Title Here" in capitals -- is clearly meant for
 * the whole box, and is stretched to the new words line by line, the way
 * ProPresenter itself records them. One that covered part of the sample can
 * only be guessed at, so it goes.
 *
 * Returns the attribute to stretch, `"drop"`, or undefined when there are
 * none -- decided once per style box, not once per slide.
 */
function attributeVerdict(attributes: any, sample: readonly string[]): any {
  const custom: any[] = attributes?.custom_attributes ?? [];
  if (custom.length === 0) return undefined;

  const joined = sample.join("\n");
  const covered = new Array(joined.length).fill(false);
  for (const a of custom) {
    for (let i = a.range?.start ?? 0; i < Math.min(a.range?.end ?? 0, covered.length); i++) {
      covered[i] = true;
    }
  }
  const wholeBox = covered.every((c, i) => c || joined[i] === "\n");

  const apartFromRange = (a: any) => canonicalObject(CustomAttribute, a, (o) => delete o.range);
  const first = apartFromRange(custom[0]);
  return wholeBox && custom.every((a) => apartFromRange(a) === first) ? custom[0] : "drop";
}

function stretchAttribute(verdict: any, lines: readonly string[]): any[] {
  if (verdict === "drop") return [];
  let offset = 0;
  return lines.map((line) => {
    const copy = wireCopy(CustomAttribute, verdict);
    copy.range = IntRange.fromObject({ start: offset, end: offset + line.length });
    offset += line.length + 1;
    return copy;
  });
}

/**
 * Point every reference to an old element uuid at its replacement.
 *
 * Builds and visibility links name elements by uuid, so renaming an element
 * without them would leave a build animating something that is not there.
 */
function remapUuids(node: any, renamed: ReadonlyMap<string, string>): void {
  if (!node || typeof node !== "object" || ArrayBuffer.isView(node)) return;
  if (typeof node.string === "string" && renamed.has(node.string)) {
    node.string = renamed.get(node.string);
  }
  for (const value of Object.values(node)) remapUuids(value, renamed);
}

/**
 * A style read once for a whole presentation.
 *
 * Everything that depends only on the style -- its bytes, each box's RTF and
 * what its attributes become -- is worked out here rather than again for
 * every slide it is applied to.
 */
interface PreparedStyle {
  bytes: Uint8Array;
  /** Per element position, for the boxes that take words. */
  boxes: Map<number, { rtf: string; attributes: any }>;
}

function prepareStyle(style: SlideStyle): PreparedStyle {
  const boxes = new Map<number, { rtf: string; attributes: any }>();
  (style.baseSlide.elements ?? []).forEach((wrapper: any, i: number) => {
    if (!isTextElement(wrapper)) return;
    const rtf = decodeRtf(wrapper.element.text.rtf_data);
    const sample = extractLines(rtf).map((l) => l.text);
    boxes.set(i, { rtf, attributes: attributeVerdict(wrapper.element.text.attributes, sample) });
  });
  return { bytes: Slide.encode(style.baseSlide).finish(), boxes };
}

/** The style's slide, rebuilt around one target slide's words. */
function restyledSlide(target: any, style: PreparedStyle, textBoxes: string[][]): any {
  const copy = Slide.decode(style.bytes) as any;
  copy.uuid = target.base_slide?.uuid;

  const renamed = new Map<string, string>();
  let next = 0;
  (copy.elements ?? []).forEach((wrapper: any, i: number) => {
    const element = wrapper.element;
    if (element?.uuid?.string) {
      const fresh = newUuid().string;
      renamed.set(element.uuid.string, fresh);
      element.uuid.string = fresh;
    }
    const box = style.boxes.get(i);
    if (!box) return;

    const lines = textBoxes[next++] ?? [];
    element.text.rtf_data = encodeRtf(restyleRtf(box.rtf, lines));
    if (box.attributes) {
      element.text.attributes.custom_attributes = stretchAttribute(box.attributes, lines);
    }
  });
  remapUuids(copy.elements, renamed);
  return copy;
}

export interface StyleResult {
  bytes: Uint8Array;
  plan: SlidePlan[];
}

/**
 * Apply `style` to every slide the plan does not leave alone.
 *
 * Gated at both ends. The file must survive re-encoding before anything is
 * touched, and afterwards the result is decoded again and checked: every
 * restyled slide must say exactly what its plan promised, every slide left
 * alone must be unchanged in every field, and so must everything in the file
 * that is not a slide. Anything else is a {@link StyleError}, never bytes.
 */
export function applyStyle(
  bytes: Uint8Array,
  style: SlideStyle,
  options: StyleOptions = {}
): StyleResult {
  if (!checkPresentationFidelity(bytes).exportSafe) throw new StyleError("lossy");

  // Two decodes: one to edit, one kept as it was to check the edit against.
  const original = decodePresentation(bytes);
  const doc = decodePresentation(bytes);
  const plan = planStyle(doc, style, options);
  const prepared = prepareStyle(style);
  slidesInOrder(doc).forEach(({ cue }, i) => {
    if (plan[i].skip) return;
    const slide = slideOf(cue);
    slide.base_slide = restyledSlide(slide, prepared, plan[i].textBoxes);
  });

  const out = encodePresentation(doc);
  verify(original, out, plan);
  return { bytes: out, plan };
}

/** The whole cue, for a slide that was meant to be left alone. */
const wholeCue = (cue: any) => canonicalObject(Cue, cue);

/** The cue with its slide's elements taken out: what restyling must not touch. */
const cueOutsideElements = (cue: any) =>
  canonicalObject(Cue, cue, (o) => {
    for (const a of o.actions ?? []) {
      const presentation = a.slide?.presentation;
      if (presentation?.base_slide) presentation.base_slide = { uuid: presentation.base_slide.uuid };
    }
  });

function verify(original: RawDoc, after: Uint8Array, plan: SlidePlan[]): void {
  const result = decodePresentation(after);
  const fail = (what: string, slide?: number) =>
    new StyleError("verifyFailed", slide === undefined ? { what } : { what, slide: String(slide + 1) });

  const withoutCues = (doc: RawDoc) => canonicalObject(Presentation, { ...doc, cues: [] });
  if (withoutCues(original) !== withoutCues(result)) throw fail("document");

  // Restyling replaces slides' elements and never adds or removes a cue, so
  // the two walks pair up slide for slide.
  const was = slidesInOrder(original);
  slidesInOrder(result).forEach(({ cue }, i) => {
    const restyled = !plan[i].skip;
    const key = restyled ? cueOutsideElements : wholeCue;
    if (key(cue) !== key(was[i].cue)) throw fail(restyled ? "slideActions" : "untouchedSlide", i);
    if (!restyled) return;
    const slide = slideOf(cue);
    if (JSON.stringify(textBoxesOf(slide, true)) !== JSON.stringify(plan[i].textBoxes)) {
      throw fail("words", i);
    }
    // Text can read back right from a document whose groups no longer close.
    for (const wrapper of slide.base_slide.elements.filter(isTextElement)) {
      if (groupDepth(decodeRtf(wrapper.element.text.rtf_data)) !== 0) throw fail("rtf", i);
    }
  });
}

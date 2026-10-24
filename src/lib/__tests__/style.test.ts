import { beforeAll, describe, expect, it } from "vitest";
import { messageType } from "../decode";
import {
  decodePresentation,
  encodePresentation,
  readPresentation,
  slidesInOrder,
} from "../presentation";
import { decodeRtf, extractLines } from "../rtf";
import {
  applyStyle,
  planStyle,
  presentationStyle,
  restyleRtf,
  StyleError,
  themeStyles,
  type SlideStyle,
} from "../style";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

const Slide = messageType("rv.data.Slide");
const Presentation = messageType("rv.data.Presentation");
const ThemeDocument = messageType("rv.data.Template.Document");

/** A Cocoa-flavoured box, as a Mac writes them: lines broken by `\` newline. */
const COCOA =
  "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2709\n{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica-Bold;}\n" +
  "\\pard\\qc\\partightenfactor0\n\n\\f0\\b\\fs200 \\cf2 \\kerning1\\expnd8\\expndtw40\n" +
  "Gloire \\'e0 ton nom\\\nGloire \\'e0 ton merveilleux nom}";

const linesOf = (rtf: string) => extractLines(rtf).map((l) => l.text);

/**
 * A style slide: a lyric box over a shape, as a theme's lower third is built.
 *
 * The shape has no text-element bit, so nothing may be poured into it.
 */
function styleSlide(
  rtf = COCOA,
  attributes?: Record<string, unknown>
): SlideStyle {
  const encode = (s: string) => new TextEncoder().encode(s);
  return {
    name: "Test style",
    baseSlide: Slide.fromObject({
      uuid: { string: "STYLE-SLIDE" },
      elements: [
        {
          info: 3,
          element: {
            uuid: { string: "STYLE-LYRICS" },
            name: "Lyrics",
            text: { rtf_data: encode(rtf), ...(attributes ? { attributes } : {}) },
          },
          build_in: { elementUUID: { string: "STYLE-LYRICS" } },
        },
        {
          info: 1,
          element: { uuid: { string: "STYLE-SHAPE" }, name: "Shape", text: { rtf_data: encode("{\\rtf1 }") } },
        },
      ],
    }),
  };
}

/** The synthetic song, with a macro on each slide: the first is the odd one out. */
function songWithMacros(names: (string | undefined)[]): Uint8Array {
  const doc = decodePresentation(syntheticTextPresentation()) as any;
  slidesInOrder(doc).forEach(({ cue }, i) => {
    const name = names[i];
    if (!name) return;
    cue.actions.push(
      messageType("rv.data.Action").fromObject({
        uuid: { string: `MACRO-${i}` },
        name,
        type: "ACTION_TYPE_MACRO",
        macro: { identification: { parameter_name: name } },
      })
    );
  });
  return encodePresentation(doc);
}

/** Each box's words, without the blank padding above and below -- as planned. */
const textsAfter = (bytes: Uint8Array) =>
  readPresentation(decodePresentation(bytes))
    .textBoxes.map((b) => {
      const lines = b.lines.map((l) => l.text);
      const shown = lines.map((t) => t.trim() !== "");
      return lines.slice(shown.indexOf(true), shown.lastIndexOf(true) + 1);
    })
    .filter((t) => t.length);

describe("restyling one box", () => {
  it("keeps the style's formatting and replaces only its words", () => {
    const out = restyleRtf(COCOA, ["Me voici,", "ébloui devant Ta face"]);
    expect(linesOf(out)).toEqual(["Me voici,", "ébloui devant Ta face"]);
    expect(out.startsWith(COCOA.slice(0, COCOA.indexOf("Gloire")))).toBe(true);
    expect(out.endsWith("}")).toBe(true);
  });

  it("escapes what RTF would otherwise read as syntax", () => {
    const words = ["{braces} and \\ backslash", "tab\there", "emoji 🙏 and “quotes”"];
    expect(linesOf(restyleRtf(COCOA, words))).toEqual(words);
  });

  it("delimits a control word the words would otherwise run into", () => {
    // `\cf2Me` is a different control word from `\cf2`.
    const tight = "{\\rtf1\\ansi\\uc1\\pard\\cf2Sample}";
    expect(linesOf(restyleRtf(tight, ["Me voici"]))).toEqual(["Me voici"]);
  });

  it("writes no fallback character where the style says escapes have none", () => {
    const uc0 = "{\\rtf1\\ansi\\uc0\\pard\\f0 Sample}";
    const out = restyleRtf(uc0, ["été"]);
    expect(out).not.toContain("?");
    expect(linesOf(out)).toEqual(["été"]);
  });

  it("fills a style box that has no words of its own", () => {
    const empty = "{\\rtf1\\ansi\\uc1\\pard\\qc\\f0\\fs100\\cf1}";
    expect(linesOf(restyleRtf(empty, ["Libre", "par la grâce"]))).toEqual(["Libre", "par la grâce"]);
  });

  it("empties a box when there is nothing to say", () => {
    expect(linesOf(restyleRtf(COCOA, [])).join("")).toBe("");
  });
});

describe("applying a style to a presentation", () => {
  it("restyles every slide and says exactly what it said before", () => {
    const before = syntheticTextPresentation();
    const { bytes, plan } = applyStyle(before, styleSlide());

    expect(plan.every((p) => !p.skip)).toBe(true);
    expect(textsAfter(bytes)).toEqual(
      plan.flatMap((p) => p.texts)
    );
    const doc = decodePresentation(bytes) as any;
    const slide = slidesInOrder(doc)[0].cue.actions[0].slide.presentation.base_slide;
    // The target slide keeps its own identity; its elements are the style's.
    expect(slide.uuid.string).toBe(
      (decodePresentation(before) as any).cues[0].actions[0].slide.presentation.base_slide.uuid.string
    );
    expect(slide.elements.map((e: any) => e.element.name)).toEqual(["Lyrics", "Shape"]);
    expect(decodeRtf(slide.elements[0].element.text.rtf_data)).toContain("Helvetica-Bold");
  });

  it("gives copied elements fresh identities, and keeps builds pointing at them", () => {
    const { bytes } = applyStyle(syntheticTextPresentation(), styleSlide());
    const slides = slidesInOrder(decodePresentation(bytes)).map(
      ({ cue }) => cue.actions[0].slide.presentation.base_slide
    );
    const lyricIds = slides.map((s: any) => s.elements[0].element.uuid.string);
    expect(new Set(lyricIds).size).toBe(slides.length);
    expect(lyricIds).not.toContain("STYLE-LYRICS");
    for (const s of slides) {
      expect(s.elements[0].build_in.elementUUID.string).toBe(s.elements[0].element.uuid.string);
    }
  });

  it("never edits the style it was given", () => {
    const style = styleSlide();
    const before = JSON.stringify(Slide.toObject(style.baseSlide));
    applyStyle(syntheticTextPresentation(), style);
    expect(JSON.stringify(Slide.toObject(style.baseSlide))).toBe(before);
  });

  it("leaves a title slide alone when its macro is not the usual one", () => {
    const song = songWithMacros(["Bienvenue", "Louange", "Louange", undefined, "Louange"]);
    const { bytes, plan } = applyStyle(song, styleSlide());
    expect(plan.map((p) => p.skip)).toEqual([
      "distinctMacro",
      ...Array(7).fill(undefined),
    ]);
    // Skipped means untouched, field for field.
    const cue = (b: Uint8Array) =>
      JSON.stringify(messageType("rv.data.Cue").toObject(slidesInOrder(decodePresentation(b))[0].cue));
    expect(cue(bytes)).toBe(cue(song));
  });

  it("restyles the title slide too when asked to", () => {
    const song = songWithMacros(["Bienvenue", "Louange", "Louange"]);
    const plan = planStyle(decodePresentation(song), styleSlide(), { skipDistinctMacro: false });
    expect(plan[0].skip).toBeUndefined();
  });

  it("makes no rule out of a tie", () => {
    const song = songWithMacros(["Bienvenue", "Louange"]);
    expect(planStyle(decodePresentation(song), styleSlide()).every((p) => !p.skip)).toBe(true);
  });

  it("skips slides by number and by macro name", () => {
    const song = songWithMacros([undefined, "Annonce"]);
    const plan = planStyle(decodePresentation(song), styleSlide(), {
      skipSlides: [3],
      skipMacros: ["Annonce"],
    });
    expect(plan.map((p) => p.skip)).toEqual([
      undefined,
      "macro",
      undefined,
      "listed",
      ...Array(4).fill(undefined),
    ]);
  });

  it("will not put two boxes of words into a style with room for one", () => {
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    const slide = doc.cues[0].actions[0].slide.presentation.base_slide;
    slide.elements.push(
      messageType("rv.data.Slide.Element").decode(
        messageType("rv.data.Slide.Element").encode(slide.elements[0]).finish()
      )
    );
    const plan = planStyle(doc, styleSlide());
    expect(plan[0].skip).toBe("moreTextThanStyle");
  });

  it("refuses a style with no box to put words in", () => {
    const style = styleSlide();
    style.baseSlide.elements[0].info = 1;
    expect(() => planStyle(decodePresentation(syntheticTextPresentation()), style)).toThrow(StyleError);
  });

  it("stretches an attribute that covered the whole sample, line by line", () => {
    const caps = { range: { start: 0, end: 17 }, capitalization: "CAPITALIZATION_ALL_CAPS" };
    const sample = "{\\rtf1\\ansi\\uc1\\pard Your Title Here!!}";
    const { bytes } = applyStyle(
      syntheticTextPresentation(),
      styleSlide(sample, { custom_attributes: [caps] })
    );
    const box = slidesInOrder(decodePresentation(bytes))[0].cue.actions[0].slide.presentation
      .base_slide.elements[0].element.text;
    // "A tidy line" / "And another"
    expect(box.attributes.custom_attributes.map((a: any) => [a.range.start, a.range.end])).toEqual([
      [0, 11],
      [12, 23],
    ]);
  });

  it("drops an attribute that covered only part of the sample", () => {
    const part = { range: { start: 0, end: 4 }, capitalization: "CAPITALIZATION_ALL_CAPS" };
    const sample = "{\\rtf1\\ansi\\uc1\\pard Your Title Here}";
    const { bytes } = applyStyle(
      syntheticTextPresentation(),
      styleSlide(sample, { custom_attributes: [part] })
    );
    const box = slidesInOrder(decodePresentation(bytes))[0].cue.actions[0].slide.presentation
      .base_slide.elements[0].element.text;
    expect(box.attributes.custom_attributes ?? []).toEqual([]);
  });
});

describe("where a style comes from", () => {
  it("takes a presentation's slide by the number ProPresenter shows", () => {
    const style = presentationStyle(syntheticTextPresentation(), 1);
    const text = decodeRtf(style.baseSlide.elements[0].element.text.rtf_data);
    expect(linesOf(text)).toEqual(["Fine here", " leading space"]);
    expect(() => presentationStyle(syntheticTextPresentation(), 99)).toThrow(StyleError);
  });

  it("lists a theme's slides in its own order", () => {
    const theme = ThemeDocument.encode(
      ThemeDocument.fromObject({
        slides: [
          { name: "Lyrics", base_slide: styleSlide().baseSlide },
          { name: "Lower 3rd", base_slide: styleSlide().baseSlide },
        ],
      })
    ).finish();
    expect(themeStyles(theme).map((s) => s.name)).toEqual(["Lyrics", "Lower 3rd"]);
  });
});

describe.skipIf(!hasRealLibrary)("applying a style across a real library", () => {
  let files: string[];
  beforeAll(() => {
    files = libraryFiles();
  });

  it("restyles every file it can read, and each says what it said before", () => {
    // `applyStyle` verifies its own output, so the assertion is that it never
    // has to refuse: every refusal here is a file it would have mangled.
    const style = styleSlide();
    const refused: string[] = [];
    let restyled = 0;
    for (const file of files) {
      const bytes = readLibraryFile(file);
      let ok = false;
      try {
        ok = Presentation.decode(bytes) !== undefined;
      } catch {
        // Not a presentation at all -- the checker reports those.
      }
      if (!ok) continue;
      try {
        restyled += applyStyle(bytes, style).plan.filter((p) => !p.skip).length;
      } catch (e) {
        if ((e as StyleError).code !== "lossy") refused.push(`${file}: ${(e as Error).message}`);
      }
    }
    expect(refused).toEqual([]);
    expect(restyled).toBeGreaterThan(0);
  });
});

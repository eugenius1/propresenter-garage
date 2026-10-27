import { beforeAll, describe, expect, it } from "vitest";
import { messageType } from "../decode";
import {
  decodePresentation,
  encodePresentation,
  readPresentation,
  shownBounds,
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
import { examine } from "../fixes";
import { hasRealLibrary, libraryFiles, readLibraryFile } from "./corpus";
import { syntheticTextPresentation } from "./synthetic";

const Slide = messageType("rv.data.Slide");
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
      const [first, last] = shownBounds(lines);
      return lines.slice(first, last + 1);
    })
    .filter((t) => t.length);

/** Each slide's `rv.data.PresentationSlide`, as ProPresenter numbers them. */
const presentations = (bytes: Uint8Array): any[] =>
  slidesInOrder(decodePresentation(bytes)).map(({ cue }) => cue.actions[0].slide.presentation);

/** Each slide's `rv.data.Slide`. */
const baseSlides = (bytes: Uint8Array): any[] => presentations(bytes).map((p) => p.base_slide);

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

  it("keeps the document's groups closed when the sample straddles one", () => {
    // Cutting "Gloire} \i nom" out of `{\b Gloire} \i nom` takes the brace
    // that closes the bold group with it.
    const grouped = "{\\rtf1\\ansi {\\b Gloire} \\i nom}";
    const out = restyleRtf(grouped, ["Majeste"]);
    expect(linesOf(out)).toEqual(["Majeste"]);
    const depth = [...out.replace(/\\./g, "")].reduce(
      (d, ch) => d + (ch === "{" ? 1 : ch === "}" ? -1 : 0),
      0
    );
    expect(depth).toBe(0);
  });

  it("writes as many fallback characters as the style says escapes have", () => {
    const uc2 = "{\\rtf1\\ansi\\uc2\\pard\\f0 Sample}";
    const out = restyleRtf(uc2, ["été"]);
    expect(out).toContain("\\u233 ??");
    expect(linesOf(out)).toEqual(["été"]);
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
    const slide = baseSlides(bytes)[0];
    // The target slide keeps its own identity; its elements are the style's.
    expect(slide.uuid.string).toBe(baseSlides(before)[0].uuid.string);
    expect(slide.elements.map((e: any) => e.element.name)).toEqual(["Lyrics", "Shape"]);
    expect(decodeRtf(slide.elements[0].element.text.rtf_data)).toContain("Helvetica-Bold");
  });

  it("keeps each slide's own box identity, and gives the style's other elements fresh ones", () => {
    // ProPresenter's Themes menu does the same: the box that takes a slide's
    // words keeps that slide's uuid, the shape behind it is new.
    const before = syntheticTextPresentation();
    const { bytes, plan } = applyStyle(before, styleSlide());
    const slides = baseSlides(bytes);
    const was = baseSlides(before);
    const withWords = plan.filter((p) => p.texts.length > 0).map((p) => p.slideIndex);
    expect(withWords.length).toBeGreaterThan(0);
    for (const i of withWords) {
      expect(slides[i].elements[0].element.uuid.string).toBe(was[i].elements[0].element.uuid.string);
    }
    const shapeIds = slides.map((s: any) => s.elements[1].element.uuid.string);
    expect(new Set(shapeIds).size).toBe(slides.length);
    expect(shapeIds).not.toContain("STYLE-SHAPE");
    for (const s of slides) {
      expect(s.elements[0].build_in.elementUUID.string).toBe(s.elements[0].element.uuid.string);
    }
  });

  it("gives a style box with no words to take a fresh identity", () => {
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    // An empty box, as on a song's Pause slide: nothing to carry over.
    const box = doc.cues[0].actions[0].slide.presentation.base_slide.elements[0];
    box.element.text.rtf_data = new TextEncoder().encode("{\\rtf1 }");
    const { bytes } = applyStyle(encodePresentation(doc), styleSlide());
    const id = baseSlides(bytes)[0].elements[0].element.uuid.string;
    expect(id).not.toBe(box.element.uuid.string);
    expect(id).not.toBe("STYLE-LYRICS");
  });

  it("brings the style's guides in as the theme's, and leaves the slide's own alone", () => {
    const style = styleSlide();
    style.baseSlide.guidelines = [
      { uuid: { string: "STYLE-GUIDE" }, location: 840 },
    ].map((g) => messageType("rv.data.AlignmentGuide").fromObject(g));
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    const target = doc.cues[0].actions[0].slide.presentation;
    target.base_slide.guidelines = [
      messageType("rv.data.AlignmentGuide").fromObject({ uuid: { string: "OWN-GUIDE" }, location: 100 }),
    ];

    const { bytes } = applyStyle(encodePresentation(doc), style);
    const after = presentations(bytes);
    expect(after[0].base_slide.guidelines.map((g: any) => g.uuid.string)).toEqual(["OWN-GUIDE"]);
    for (const p of after) {
      expect(p.template_guidelines.map((g: any) => g.location)).toEqual([840]);
      expect(p.template_guidelines[0].uuid.string).not.toBe("STYLE-GUIDE");
    }
    expect(new Set(after.map((p) => p.template_guidelines[0].uuid.string)).size).toBe(after.length);
  });

  it("records the style's font over the new words, as ProPresenter does", () => {
    const font = { name: "Arial-BoldMT", size: 60, bold: true, family: "Arial" };
    const caps = { range: { start: 0, end: 17 }, capitalization: "CAPITALIZATION_ALL_CAPS" };
    const sample = "{\\rtf1\\ansi\\uc1\\pard Your Title Here!!}";
    const { bytes } = applyStyle(
      syntheticTextPresentation(),
      styleSlide(sample, { font, custom_attributes: [caps] })
    );
    const custom = baseSlides(bytes)[0].elements[0].element.text.attributes.custom_attributes;
    // "A tidy line" / "And another": capitals line by line, the font over all.
    expect(custom.map((a: any) => [a.range.start ?? 0, a.range.end])).toEqual([[0, 11], [12, 23], [0, 23]]);
    expect(messageType("rv.data.Font").toObject(custom[2].original_font)).toEqual(font);
  });

  it("gives a themed song another theme, shape and all", () => {
    // The first theme's shape is the theme's, not the slide's own: counting
    // it as an element of the slide's would refuse every slide.
    const style = styleSlide(COCOA, { font: { name: "Arial-BoldMT", family: "Arial" } });
    style.baseSlide.guidelines = [
      messageType("rv.data.AlignmentGuide").fromObject({ uuid: { string: "STYLE-GUIDE" }, location: 840 }),
    ];
    const once = applyStyle(syntheticTextPresentation(), style);
    const twice = applyStyle(once.bytes, style);
    expect(twice.plan.map((p) => p.skip)).toEqual(once.plan.map((p) => p.skip));
    expect(textsAfter(twice.bytes)).toEqual(textsAfter(once.bytes));
    expect(baseSlides(twice.bytes)[0].elements).toHaveLength(2);
  });

  it("still leaves alone a shape of the slide's own on a slide no theme filled", () => {
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    doc.cues[0].actions[0].slide.presentation.base_slide.elements.push(
      messageType("rv.data.Slide.Element").fromObject({
        info: 1,
        element: { uuid: { string: "BADGE" }, name: "Badge", text: { rtf_data: new TextEncoder().encode("{\\rtf1 }") } },
      })
    );
    expect(planStyle(doc, styleSlide())[0].skip).toBe("otherElements");
  });

  it("passes on the theme's font from a style that was itself themed", () => {
    // A slide restyled once already: its box has since been set in another
    // font, but the font the theme gave it is the one to carry on.
    const themed = { name: "Arial-BoldMT", family: "Arial" };
    const style = styleSlide("{\\rtf1\\ansi\\uc1\\pard Sample}", {
      font: { name: "Helvetica", family: "Helvetica" },
      custom_attributes: [{ range: { start: 0, end: 6 }, original_font: themed }],
    });
    const { bytes } = applyStyle(syntheticTextPresentation(), style);
    const custom = baseSlides(bytes)[0].elements[0].element.text.attributes.custom_attributes;
    expect(custom).toHaveLength(1);
    expect(messageType("rv.data.Font").toObject(custom[0].original_font)).toEqual(themed);
    expect(custom[0].range.end).toBe(23);
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

  it("still restyles a lyric slide that fires another macro as well", () => {
    const doc = decodePresentation(
      songWithMacros(["Bienvenue", "Louange", "Louange", "Louange"])
    ) as any;
    // A lighting cue on top of the usual macro on slide 3.
    slidesInOrder(doc)[2].cue.actions.push(
      messageType("rv.data.Action").fromObject({
        uuid: { string: "LIGHTS" },
        type: "ACTION_TYPE_MACRO",
        macro: { identification: { parameter_name: "Lumières" } },
      })
    );
    const plan = planStyle(doc, styleSlide());
    expect(plan[0].skip).toBe("distinctMacro");
    expect(plan[2].skip).toBeUndefined();
  });

  it("leaves a slide alone that holds more than its words, unless told otherwise", () => {
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    // An image of its own beside the text box.
    doc.cues[0].actions[0].slide.presentation.base_slide.elements.push(
      messageType("rv.data.Slide.Element").fromObject({
        info: 1,
        element: { uuid: { string: "PHOTO" }, name: "Photo" },
      })
    );
    expect(planStyle(doc, styleSlide())[0].skip).toBe("otherElements");
    expect(planStyle(doc, styleSlide(), { replaceOtherElements: true })[0].skip).toBeUndefined();
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

  it.each([
    // "Your Title Here!!" in capitals throughout: meant for the whole box, so
    // stretched over "A tidy line" / "And another" a line at a time.
    ["covered the whole sample", { start: 0, end: 17 }, [[0, 11], [12, 23]]],
    // Part of it only, which cannot be carried over to other words.
    ["covered only part of the sample", { start: 0, end: 4 }, []],
  ])("handles an attribute that %s", (_, range, expected) => {
    const caps = { range, capitalization: "CAPITALIZATION_ALL_CAPS" };
    const sample = "{\\rtf1\\ansi\\uc1\\pard Your Title Here!!}";
    const { bytes } = applyStyle(
      syntheticTextPresentation(),
      styleSlide(sample, { custom_attributes: [caps] })
    );
    const box = baseSlides(bytes)[0].elements[0].element.text;
    expect(
      (box.attributes.custom_attributes ?? []).map((a: any) => [a.range.start, a.range.end])
    ).toEqual(expected);
  });
});

describe("where a style comes from", () => {
  it("takes a presentation's slide by the number ProPresenter shows", () => {
    const style = presentationStyle(syntheticTextPresentation(), 1);
    const text = decodeRtf(style.baseSlide.elements[0].element.text.rtf_data);
    expect(linesOf(text)).toEqual(["Fine here", " leading space"]);
    expect(() => presentationStyle(syntheticTextPresentation(), 99)).toThrow(StyleError);
  });

  it("takes a themed slide's guides from where its theme put them", () => {
    const doc = decodePresentation(syntheticTextPresentation()) as any;
    doc.cues[0].actions[0].slide.presentation.template_guidelines = [
      messageType("rv.data.AlignmentGuide").fromObject({ uuid: { string: "THEME-GUIDE" }, location: 631 }),
    ];
    const style = presentationStyle(encodePresentation(doc), 0);
    expect(style.guidelines?.map((g: any) => g.location)).toEqual([631]);
    expect(presentationStyle(syntheticTextPresentation(), 0).guidelines).toEqual([]);
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
      // Not a presentation at all: the checker reports those.
      if (examine(file, bytes).report.error) continue;
      try {
        restyled += applyStyle(bytes, style).plan.filter((p) => !p.skip).length;
      } catch (e) {
        if ((e as StyleError).code !== "lossy") refused.push(`${file}: ${(e as Error).message}`);
      }
    }
    expect(refused).toEqual([]);
    expect(restyled).toBeGreaterThan(0);
  }, 120_000);
});

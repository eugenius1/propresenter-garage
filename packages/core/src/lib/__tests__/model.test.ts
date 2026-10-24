import { describe, expect, it } from "vitest";
import { buildLibrary, decodeMediaDocument, rawItems, walkNodes } from "../model";
import { syntheticMediaFile } from "./synthetic";

describe("media kind", () => {
  it("goes by the media element when the action says otherwise", () => {
    // A real media bin written by ProPresenter 20 carried an empty
    // action-level `audio` on every one of its 338 videos and stills.
    const expected = buildLibrary(decodeMediaDocument(syntheticMediaFile())).items.map(
      (i) => i.kind
    );
    const doc = decodeMediaDocument(syntheticMediaFile()) as any;
    for (const item of walkNodes(doc.root_node).flatMap(rawItems)) {
      const media = item.cue.actions.find((a: any) => a.media).media;
      delete media.image;
      delete media.video;
      media.audio = {};
    }

    expect(buildLibrary(doc).items.map((i) => i.kind)).toEqual(expected);
    expect(expected).toContain("video");
    expect(expected).toContain("image");
  });
});

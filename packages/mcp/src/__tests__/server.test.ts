import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { syntheticMediaFile, syntheticTextPresentation, SYNTHETIC } from "@propresenter-garage/core/lib/__tests__/synthetic";
import { encodeDocument, messageType } from "@propresenter-garage/core/lib/decode";
import { decodeMediaDocument, rawItems, walkNodes } from "@propresenter-garage/core/lib/model";
import { applyOperations } from "@propresenter-garage/core/lib/operations";
import { decodePlaylistsDocument, headerEntry, mediaEntry, presentationEntry } from "@propresenter-garage/core/lib/playlists";
import { decodePresentation, encodePresentation, slidesInOrder } from "@propresenter-garage/core/lib/presentation";
import { syntheticPresentationFile } from "@propresenter-garage/core/lib/__tests__/synthetic";
import { openRoots, readFoundFile, resolveInRoots } from "../library";
import { createServer } from "../server";
import { auditMediaBin } from "../tools";

/**
 * The server end to end, over an in-memory pipe, against a library built on
 * disk from the synthetic fixtures. Going through a real client means the
 * schemas, the argument parsing and the error wrapping are all exercised, not
 * just the functions behind them.
 */

/** A server over the given folders, and a client talking to it over an in-memory pipe. */
async function connect(roots: string[]) {
  const server = createServer(await openRoots(roots));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0].text;
    return { isError: !!result.isError, text, json: () => JSON.parse(text) };
  };
  return { client, call };
}

let tmp: string;
let library: string;
let client: Client;
let call: Awaited<ReturnType<typeof connect>>["call"];

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pp-mcp-")));
  library = path.join(tmp, "ProPresenter");
  const songs = path.join(library, "Libraries", "Default");
  fs.mkdirSync(songs, { recursive: true });
  fs.mkdirSync(path.join(library, "Playlists"));

  fs.writeFileSync(path.join(songs, "Checked Song.pro"), syntheticTextPresentation());
  fs.writeFileSync(path.join(songs, "Sainte Cène.pro"), syntheticTextPresentation("Sainte Cène"));
  fs.writeFileSync(path.join(songs, "Chords.pro"), "{title: Amazing Grace}\n[G]Amazing grace\n");
  fs.writeFileSync(path.join(songs, "._Checked Song.pro"), "resource fork noise");
  // A presentation with nothing to report, so a clean file stays unlisted.
  const Presentation = messageType("rv.data.Presentation");
  fs.writeFileSync(path.join(songs, "Clean.pro"), Presentation.encode(Presentation.fromObject({ name: "Clean" })).finish());
  // One the walk finds but cannot open.
  fs.writeFileSync(path.join(songs, "Locked.pro"), syntheticTextPresentation("Locked"));
  fs.chmodSync(path.join(songs, "Locked.pro"), 0o000);
  fs.writeFileSync(path.join(library, "Playlists", "Media"), syntheticMediaFile());

  // Outside the library, and a link inside it pointing there.
  fs.writeFileSync(path.join(tmp, "secret.txt"), "not yours");
  fs.symlinkSync(path.join(tmp, "secret.txt"), path.join(songs, "escape.pro"));

  ({ client, call } = await connect([library]));
});

afterAll(async () => {
  await client?.close();
  fs.chmodSync(path.join(library, "Libraries", "Default", "Locked.pro"), 0o644);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("the tools offered", () => {
  it("are all read-only", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "audit_media_bin",
      "check_presentations",
      "list_presentations",
      "list_themes",
      "preview_style",
      "read_media_bin",
      "read_playlists",
      "read_presentation",
      "search_text",
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("are the ones the Claude Desktop extension says it has", async () => {
    // Claude Desktop shows the manifest's list before the server ever runs.
    const manifest = JSON.parse(fs.readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));
    const { tools } = await client.listTools();
    expect(manifest.tools.map((t: { name: string }) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

describe("list_presentations", () => {
  it("lists .pro files, skipping hidden files and symlinks", async () => {
    const { presentations } = (await call("list_presentations")).json();
    const names = presentations.map((p: { name: string }) => p.name);
    expect(names).toContain("Checked Song");
    expect(names).toContain("Sainte Cène");
    expect(names).not.toContain("._Checked Song");
    expect(names).not.toContain("escape");
    expect(presentations[0].library).toBe("Default");
  });

  it("filters ignoring case and accents", async () => {
    const { presentations } = (await call("list_presentations", { query: "cene" })).json();
    expect(presentations.map((p: { name: string }) => p.name)).toEqual(["Sainte Cène"]);
  });
});

describe("read_presentation", () => {
  it("returns each slide's lines with the addresses a fix would use", async () => {
    const doc = (await call("read_presentation", { path: "Libraries/Default/Checked Song.pro" })).json();
    expect(doc.name).toBe("Checked Song");
    expect(doc.fidelity).not.toBe("lossy");
    expect(doc.emptyTextBoxes).toBe(1);

    const first = doc.slides[0];
    expect(first).toMatchObject({ slideIndex: 0, label: "Clean", group: "Verse" });
    expect(first.textBoxes[0]).toEqual({ boxIndex: 0, lines: ["A tidy line", "And another"] });
    // A slide whose only box is an empty placeholder is still listed, with no boxes.
    expect(doc.slides).toHaveLength(doc.slideCount);
    expect(doc.slides.find((s: { label: string }) => s.label === "Empty").textBoxes).toEqual([]);
  });

  it("names a chord chart for what it is", async () => {
    const result = await call("read_presentation", { path: "Libraries/Default/Chords.pro" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/ChordPro/);
  });

  it("refuses a symlink that leads out of the library", async () => {
    const result = await call("read_presentation", { path: "Libraries/Default/escape.pro" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Outside/);
  });

  it("refuses a path that climbs out of the library", async () => {
    const result = await call("read_presentation", { path: "../secret.txt" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Outside/);
  });

  it("refuses an absolute path elsewhere", async () => {
    const result = await call("read_presentation", { path: path.join(tmp, "secret.txt") });
    expect(result.isError).toBe(true);
  });
});

describe("search_text", () => {
  it("finds a line ignoring case and accents, and reports what it could not read", async () => {
    const result = (await call("search_text", { query: "TIDY" })).json();
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ slideIndex: 0, boxIndex: 0, lineIndex: 0, text: "A tidy line" });
    expect(result.unreadable.map((p: string) => path.basename(p))).toEqual(["Chords.pro", "Locked.pro"]);
  });

  it("stops at the limit and says so", async () => {
    const result = (await call("search_text", { query: "tidy", limit: 1 })).json();
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
    // Counts the files it got through, up to the one holding the match it
    // stopped at -- here the last, after the chord chart, the clean file and
    // the locked one.
    expect(result.filesSearched).toBe(5);
  });

  it("refuses a file passed as the folder rather than finding nothing", async () => {
    const result = await call("search_text", { query: "tidy", folder: "Libraries/Default/Checked Song.pro" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Not a folder/);
  });

  it("refuses an empty query", async () => {
    expect((await call("search_text", { query: "  " })).isError).toBe(true);
  });
});

describe("check_presentations", () => {
  it("gives the same findings as the browser tool", async () => {
    const result = (await call("check_presentations", { path: "Libraries/Default/Checked Song.pro" })).json();
    expect(result.filesChecked).toBe(1);
    expect(result.totals).toMatchObject({ leadingSpace: 1, trailingSpace: 1, blankLine: 1, repeatedSpace: 1 });
  });

  it("refuses a file that is not a presentation", async () => {
    const result = await call("check_presentations", { path: "Playlists/Media" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Not a presentation/);
  });

  it("checks a whole folder, carrying on past files it cannot read", async () => {
    const result = (await call("check_presentations")).json();
    const byName = Object.fromEntries(
      result.files.map((f: { path: string }) => [path.basename(f.path), f])
    );
    expect(byName["Checked Song.pro"].issues.length).toBeGreaterThan(0);
    expect(byName["Chords.pro"].error).toMatch(/ChordPro/);
    expect(byName["Locked.pro"].error).toMatch(/Could not read/);
    expect(byName["Clean.pro"]).toBeUndefined();
  });

  it("says when it listed fewer files than had findings", async () => {
    const result = (await call("check_presentations", { limit: 1 })).json();
    expect(result.files).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe("the media bin", () => {
  it("is found in Playlists/Media when no path is given", async () => {
    const bin = (await call("read_media_bin")).json();
    expect(bin.itemCount).toBe(SYNTHETIC.items);
    expect(bin.playlists).toHaveLength(SYNTHETIC.playlistsWithItems);
  });

  it("is audited with items cut down to what identifies them", async () => {
    const audit = (await call("audit_media_bin")).json();
    expect(audit.totals.items).toBe(SYNTHETIC.items);
    expect(audit.emptyPlaylists).toHaveLength(SYNTHETIC.emptyPlaylists);
    for (const item of audit.hiddenItems) expect(item).not.toHaveProperty("variantKey");
  });

  it("says where to look when there is none", async () => {
    await expect(auditMediaBin([path.join(library, "Libraries")])).rejects.toThrow(/No media bin found/);
  });

  it("refuses a presentation passed as a media bin", async () => {
    const result = await call("read_media_bin", { path: "Libraries/Default/Checked Song.pro" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not a ProPresenter media bin/);
  });
});

describe("openRoots", () => {
  it("refuses a folder that does not exist", async () => {
    await expect(openRoots([path.join(tmp, "missing")])).rejects.toThrow(/not found/);
  });

  it("refuses a file given as a folder", async () => {
    await expect(openRoots([path.join(tmp, "secret.txt")])).rejects.toThrow(/Not a folder/);
  });
});

describe("resolveInRoots", () => {
  it("tries a relative path against every root, not just the first", async () => {
    const first = path.join(tmp, "first");
    fs.mkdirSync(first, { recursive: true });
    fs.symlinkSync(tmp, path.join(first, "Libraries"));
    const roots = await openRoots([first, library]);
    await expect(resolveInRoots(roots, "Libraries/Default/Checked Song.pro")).resolves.toBe(
      path.join(library, "Libraries", "Default", "Checked Song.pro")
    );
  });

  it("does not mistake a sibling folder sharing a prefix for the root", async () => {
    const sibling = `${library}-other`;
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, "x.pro"), "");
    await expect(resolveInRoots([library], path.join(sibling, "x.pro"))).rejects.toThrow(/Outside/);
  });
});

describe("readFoundFile", () => {
  it("refuses a symlink rather than following it", async () => {
    await expect(readFoundFile(path.join(library, "Libraries", "Default", "escape.pro"))).rejects.toThrow(
      /Could not read/
    );
  });

  it("refuses a folder", async () => {
    await expect(readFoundFile(library)).rejects.toThrow(/Not a file|Could not read/);
  });
});

describe("what a presentation records about itself", () => {
  // A library of its own, so the counts the tests above assert stay put.
  let dated: string;
  let server: Awaited<ReturnType<typeof connect>>;
  const at = (iso: string) => ({ seconds: Date.parse(iso) / 1000 });
  const list = async (args: Record<string, unknown> = {}) =>
    (await server.call("list_presentations", args)).json();
  const read = async (file: string) => (await server.call("read_presentation", { path: file })).json();

  beforeAll(async () => {
    dated = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pp-mcp-dated-")));
    const Presentation = messageType("rv.data.Presentation");
    const write = (name: string, fields: Record<string, unknown>) =>
      fs.writeFileSync(
        path.join(dated, `${name}.pro`),
        Presentation.encode(Presentation.fromObject({ name, ...fields })).finish()
      );

    write("Recent", {
      application_info: {
        platform: "PLATFORM_WINDOWS",
        application_version: { major_version: 21, minor_version: 4, patch_version: 2 },
      },
      last_date_used: at("2026-10-13T18:37:48Z"),
      last_modified_date: at("2026-10-23T18:47:31Z"),
      category: "Louange",
      notes: "Capo 2 pour la chorale",
      ccli: { song_title: "Recent", author: "Someone", song_number: 1234567, copyright_year: 2019 },
      music: { original_music_key: "G", user_music_key: "A" },
      cue_groups: [
        { group: { uuid: { string: "g-verse" }, name: "Couplet" } },
        { group: { uuid: { string: "g-chorus" }, name: "Refrain" } },
      ],
      arrangements: [
        {
          uuid: { string: "a-1" },
          name: "Dimanche",
          group_identifiers: [{ string: "g-verse" }, { string: "g-chorus" }, { string: "g-gone" }],
        },
      ],
    });
    write("Old", { last_date_used: at("2024-01-07T10:00:00Z") });
    write("Never", {});
    fs.writeFileSync(path.join(dated, "Chords.pro"), "{title: Amazing Grace}\n[G]Amazing grace\n");

    server = await connect([dated]);
  });

  afterAll(async () => {
    await server?.client.close();
    fs.rmSync(dated, { recursive: true, force: true });
  });

  it("reads ProPresenter's dates, notes, CCLI, key and arrangements", async () => {
    const doc = await read("Recent.pro");
    expect(doc).toMatchObject({
      lastUsed: "2026-10-13T18:37:48.000Z",
      lastModified: "2026-10-23T18:47:31.000Z",
      category: "Louange",
      notes: "Capo 2 pour la chorale",
      ccli: { songTitle: "Recent", author: "Someone", songNumber: 1234567, copyrightYear: 2019 },
      musicKey: { original: "G", user: "A" },
      arrangements: [{ name: "Dimanche", groups: ["Couplet", "Refrain", null] }],
      savedBy: { appVersion: "21.4.2", platform: "WINDOWS" },
    });
    expect(doc.fileModified).toEqual(expect.any(String));
    expect(doc).not.toHaveProperty("created");
  });

  it("leaves out what a file does not record", async () => {
    const doc = await read("Never.pro");
    for (const key of ["lastUsed", "lastModified", "category", "notes", "ccli", "musicKey", "savedBy"]) {
      expect(doc[key]).toBeUndefined();
    }
    expect(doc.arrangements).toEqual([]);
  });

  it("lists without opening any file unless asked about use", async () => {
    const { presentations, unreadable } = await list();
    expect(unreadable).toBeUndefined();
    for (const p of presentations) {
      expect(p.fileModified).toEqual(expect.any(String));
      expect(p).not.toHaveProperty("lastUsed");
    }
  });

  it("finds what has not been shown since a date, never-shown included", async () => {
    const { presentations, unreadable } = await list({ notUsedSince: "2025-01-01" });
    expect(presentations.map((p: { name: string }) => p.name).sort()).toEqual(["Never", "Old"]);
    expect(presentations.find((p: { name: string }) => p.name === "Never").lastUsed).toBeNull();
    // A file it could not decode is said so, not quietly counted as unused.
    expect(unreadable.map((f: string) => path.basename(f))).toEqual(["Chords.pro"]);
  });

  it("finds what has been shown since a date, most recent first", async () => {
    const recent = await list({ usedSince: "2025-01-01" });
    expect(recent.presentations.map((p: { name: string }) => p.name)).toEqual(["Recent"]);

    const sorted = await list({ sort: "lastUsed" });
    expect(sorted.presentations.map((p: { name: string }) => p.name)).toEqual(["Recent", "Old", "Never"]);
  });

  it("refuses a date it cannot read", async () => {
    const result = await server.call("list_presentations", { usedSince: "last spring" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not a date/);
  });

  it("tells the calling model about the cost and the missing creation date", async () => {
    const { tools } = await server.client.listTools();
    const about = (name: string) => tools.find((t) => t.name === name)!.description!;
    expect(about("list_presentations")).toMatch(/decoded/);
    expect(about("read_presentation")).toMatch(/Prefer `lastModified`/);
    for (const name of ["list_presentations", "read_presentation"]) {
      expect(about(name)).toMatch(/No creation date/);
    }
  });
});

describe("playlists and themes", () => {
  // A ProPresenter folder of its own, so the counts the tests above assert stay put.
  let show: string;
  let server: Awaited<ReturnType<typeof connect>>;
  const json = async (name: string, args: Record<string, unknown> = {}) => (await server.call(name, args)).json();
  const song = () => path.join(show, "Libraries", "Default", "Checked Song.pro");

  /** A theme slide whose one text box is set in bold, centred, over a shape. */
  const lyricsSlide = {
    elements: [
      {
        info: 3,
        element: {
          uuid: { string: "THEME-LYRICS" },
          name: "Lyrics",
          text: {
            rtf_data: new TextEncoder().encode(
              "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2709\n{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica-Bold;}\n" +
                "\\pard\\qc\\partightenfactor0\n\n\\f0\\b\\fs200 \\cf2 Style words}"
            ),
          },
        },
      },
      { info: 1, element: { uuid: { string: "THEME-SHAPE" }, name: "Shape" } },
    ],
  };

  beforeAll(async () => {
    show = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pp-mcp-show-")));
    fs.mkdirSync(path.join(show, "Libraries", "Default"), { recursive: true });
    fs.mkdirSync(path.join(show, "Playlists"));
    fs.writeFileSync(song(), syntheticTextPresentation());
    fs.writeFileSync(path.join(show, "Playlists", "Media"), syntheticMediaFile());

    // A presentation whose second slide's box is marked as a text element, so it can lend its look.
    const styled = decodePresentation(syntheticTextPresentation("Styled")) as any;
    slidesInOrder(styled)[1].cue.actions[0].slide.presentation.base_slide.elements[0].info = 3;
    fs.writeFileSync(path.join(show, "Libraries", "Default", "Styled.pro"), encodePresentation(styled));

    // A service: a header, the song, and a background from the media bin.
    const playlists = decodePlaylistsDocument(syntheticPresentationFile()) as any;
    const sunday = playlists.root_node.playlists.playlists[0].uuid.string;
    const background = walkNodes((decodeMediaDocument(syntheticMediaFile()) as any).root_node).flatMap(rawItems)[0];
    const location = { root: show, platform: "PLATFORM_MACOS" as const };
    const service = applyOperations(playlists, [
      { kind: "insertItem", playlistUuid: sunday, itemName: "Chants", entry: headerEntry("Chants") },
      {
        kind: "insertItem",
        playlistUuid: sunday,
        itemName: "Checked Song",
        entry: presentationEntry({ path: "Libraries/Default/Checked Song.pro", location }),
      },
      { kind: "insertItem", playlistUuid: sunday, itemName: "Fond", entry: mediaEntry(background) },
    ]);
    fs.writeFileSync(path.join(show, "Playlists", "Library"), encodeDocument(service));

    const Theme = messageType("rv.data.Template.Document");
    fs.mkdirSync(path.join(show, "Themes", "White"), { recursive: true });
    fs.writeFileSync(
      path.join(show, "Themes", "White", "Theme"),
      Theme.encode(
        Theme.fromObject({
          slides: [
            { name: "Lyrics", base_slide: lyricsSlide },
            { name: "Blank", base_slide: { elements: [] } },
          ],
        })
      ).finish()
    );
    fs.mkdirSync(path.join(show, "Themes", "Broken"), { recursive: true });
    fs.writeFileSync(path.join(show, "Themes", "Broken", "Theme"), "not a theme");

    server = await connect([show]);
  });

  afterAll(async () => {
    await server?.client.close();
    fs.rmSync(show, { recursive: true, force: true });
  });

  it("reads a service from Playlists/Library, entries in order", async () => {
    const result = await json("read_playlists");
    expect(result.path).toBe(path.join(show, "Playlists", "Library"));
    expect(result.playlists).toEqual([
      {
        path: "Sunday",
        items: [
          { kind: "header", name: "Chants" },
          { kind: "presentation", name: "Checked Song", file: "Libraries/Default/Checked Song.pro" },
          // A media entry is the media bin's cue, under the bin's own name.
          { kind: "media", name: "Rose Gradient", file: "Media/Assets/rose-gradient.jpg" },
        ],
      },
    ]);
  });

  it("hands out a presentation's file in a form read_presentation takes back", async () => {
    const entry = (await json("read_playlists")).playlists[0].items[1];
    expect((await json("read_presentation", { path: entry.file })).name).toBe("Checked Song");
  });

  it("refuses the media bin passed as the presentation playlists", async () => {
    const result = await server.call("read_playlists", { path: "Playlists/Media" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not ProPresenter's presentation playlists/);
  });

  it("lists each theme's styles, and names one it cannot read", async () => {
    const { themes, unreadable } = await json("list_themes");
    expect(themes).toEqual([
      {
        name: "White",
        path: path.join(show, "Themes", "White", "Theme"),
        styles: [
          { styleIndex: 0, name: "Lyrics", textBoxes: 1 },
          { styleIndex: 1, name: "Blank", textBoxes: 0 },
        ],
      },
    ]);
    expect(unreadable).toEqual([expect.objectContaining({ path: path.join(show, "Themes", "Broken", "Theme") })]);
  });

  it("previews a theme style slide by slide, and writes nothing", async () => {
    const before = fs.readFileSync(song());
    const preview = await json("preview_style", { path: song(), theme: "white", style: "Lyrics" });

    expect(preview).toMatchObject({ style: "Lyrics", fidelity: expect.stringMatching(/identical|equivalent/) });
    expect(preview.restyled + preview.leftAlone).toBe(preview.slides.length);
    expect(preview.slides.find((s: any) => s.label === "Leading").textBoxes).toEqual([{ lines: ["Fine here", " leading space"] }]);
    expect(fs.readFileSync(song())).toEqual(before);
  });

  it("leaves alone the slides it is told to, and says why", async () => {
    const preview = await json("preview_style", { path: song(), theme: "White", style: 0, skipSlides: [1] });
    expect(preview.slides[1].skip).toBe("listed");
    expect(preview.slides[0].skip).toBeUndefined();
  });

  it("takes a style from another presentation's slide, numbered as read_presentation numbers it", async () => {
    const preview = await json("preview_style", { path: song(), fromPresentation: "Libraries/Default/Styled.pro", style: 1 });
    expect(preview.style).toBe("Styled 2");
    expect(preview.restyled).toBeGreaterThan(0);
  });

  it("says what is wrong with a style it cannot use", async () => {
    const error = async (args: Record<string, unknown>) => {
      const result = await server.call("preview_style", { path: song(), ...args });
      expect(result.isError).toBe(true);
      return result.text;
    };
    expect(await error({ theme: "White" })).toMatch(/2 styles.*0: Lyrics, 1: Blank/);
    expect(await error({ theme: "White", style: "Chorus" })).toMatch(/No style "Chorus".*0: Lyrics/);
    expect(await error({ theme: "White", style: "Blank" })).toMatch(/has no text box/);
    expect(await error({ theme: "Navy" })).toMatch(/No theme named "Navy"/);
    expect(await error({ theme: "Broken" })).toMatch(/not a ProPresenter theme/);
    expect(await error({ theme: "White", fromPresentation: "Libraries/Default/Styled.pro" })).toMatch(/exactly one/);
    expect(await error({ fromPresentation: "Libraries/Default/Styled.pro", style: 99 })).toMatch(/no slide 100/);
  });
});

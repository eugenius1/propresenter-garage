import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { syntheticMediaFile, syntheticTextPresentation, SYNTHETIC } from "../../lib/__tests__/synthetic";
import { messageType } from "../../lib/decode";
import { openRoots, readFoundFile, resolveInRoots } from "../library";
import { createServer } from "../server";
import { auditMediaBin } from "../tools";

/**
 * The server end to end, over an in-memory pipe, against a library built on
 * disk from the synthetic fixtures. Going through a real client means the
 * schemas, the argument parsing and the error wrapping are all exercised, not
 * just the functions behind them.
 */

let tmp: string;
let library: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: !!result.isError, text, json: () => JSON.parse(text) };
}

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

  const server = createServer(await openRoots([library]));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
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
      "read_media_bin",
      "read_presentation",
      "search_text",
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("are the ones the Claude Desktop extension says it has", async () => {
    // Claude Desktop shows the manifest's list before the server ever runs.
    const manifest = JSON.parse(fs.readFileSync(new URL("../../../mcpb/manifest.json", import.meta.url), "utf8"));
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
    expect(doc.slides.find((s: { label: string }) => s.label === "Empty")).toBeUndefined();
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

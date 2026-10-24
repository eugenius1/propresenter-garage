import { describe, expect, it } from "vitest";
import { encodeDocument, messageType } from "../decode";
import { decodeMediaDocument, rawItems, walkNodes } from "../model";
import { applyOperations } from "../operations";
import {
  decodePlaylistsDocument,
  headerEntry,
  mediaEntry,
  presentationEntry,
  showLocationOf,
  type ShowLocation,
} from "../playlists";
import { syntheticMediaFile, syntheticPresentationFile } from "./synthetic";

const PlaylistItem = messageType("rv.data.PlaylistItem");
const asObject = (entry: unknown) =>
  PlaylistItem.toObject(entry as never, { enums: String }) as any;

/** The first entry of the synthetic media bin. */
const firstMediaItem = () =>
  walkNodes((decodeMediaDocument(syntheticMediaFile()) as any).root_node).flatMap(rawItems)[0];

const MAC: ShowLocation = { root: "/Users/me/Documents/ProPresenter", platform: "PLATFORM_MACOS" };

describe("a presentation entry", () => {
  it("is written the way ProPresenter writes one on a Mac", () => {
    // Checked against an entry ProPresenter 20 wrote for this very file:
    // decomposed accents, spaces and accents escaped, commas left alone.
    const entry = asObject(
      presentationEntry({ path: "Libraries/Chants/Gloire à ton nom, Jésus.pro", location: MAC })
    );
    expect(entry.presentation.document_path).toEqual({
      absolute_string:
        "file:///Users/me/Documents/ProPresenter/Libraries/Chants/Gloire%20a%CC%80%20ton%20nom,%20Je%CC%81sus.pro",
      platform: "PLATFORM_MACOS",
      local: { root: "ROOT_SHOW", path: "Libraries/Chants/Gloire a\u0300 ton nom, Je\u0301sus.pro" },
    });
    expect(entry.name).toBe("Gloire a\u0300 ton nom, Je\u0301sus");
  });

  it("escapes the characters a URL would otherwise end at", () => {
    const url = asObject(presentationEntry({ path: "Libraries/Chants/Hymne #1?.pro", location: MAC }))
      .presentation.document_path.absolute_string;
    expect(url).toContain("Hymne%20%231%3F.pro");
  });

  it("takes the name it is given", () => {
    expect(asObject(presentationEntry({ path: "Libraries/A/b.pro", name: "Ouverture" })).name).toBe(
      "Ouverture"
    );
  });

  it("writes a Windows path for a Windows library", () => {
    const entry = asObject(
      presentationEntry({
        path: "Libraries/Chants/Majeste.pro",
        location: { root: "C:\\Users\\me\\Documents\\ProPresenter", platform: "PLATFORM_WIN32" },
      })
    );
    expect(entry.presentation.document_path.absolute_string).toBe(
      "C:\\Users\\me\\Documents\\ProPresenter\\Libraries\\Chants\\Majeste.pro"
    );
    expect(entry.presentation.document_path.platform).toBe("PLATFORM_WIN32");
  });

  it("carries only the relative path when nobody knows where the folder is", () => {
    const path = asObject(presentationEntry({ path: "Libraries/Chants/Majeste.pro" })).presentation
      .document_path;
    expect(path.absolute_string).toBeUndefined();
    expect(path.local).toEqual({ root: "ROOT_SHOW", path: "Libraries/Chants/Majeste.pro" });
  });

  it("gets a fresh identity every time", () => {
    const a = presentationEntry({ path: "Libraries/A/b.pro" }) as any;
    const b = presentationEntry({ path: "Libraries/A/b.pro" }) as any;
    expect(a.uuid.string).not.toBe(b.uuid.string);
  });
});

describe("where the ProPresenter folder is", () => {
  it("is read back from an entry already in the document", () => {
    const doc = decodePlaylistsDocument(syntheticPresentationFile()) as any;
    expect(showLocationOf(doc)).toBeUndefined();

    const sunday = doc.root_node.playlists.playlists[0];
    const edited = applyOperations(doc, [
      {
        kind: "insertItem",
        playlistUuid: sunday.uuid.string,
        itemName: "x",
        entry: presentationEntry({ path: "Libraries/Chants/Gloire à ton nom.pro", location: MAC }),
      },
    ]);
    expect(showLocationOf(edited)).toEqual(MAC);
  });
});

describe("where the folder is, from an awkward name", () => {
  it("reads back an entry whose file name holds a # or a ?", () => {
    const doc = decodePlaylistsDocument(syntheticPresentationFile()) as any;
    const edited = applyOperations(doc, [
      {
        kind: "insertItem",
        playlistUuid: doc.root_node.playlists.playlists[0].uuid.string,
        itemName: "x",
        entry: presentationEntry({ path: "Libraries/Chants/Hymne #1?.pro", location: MAC }),
      },
    ]);
    expect(showLocationOf(edited)).toEqual(MAC);
  });
});

describe("a media entry", () => {
  it("is the media bin's cue under identities of its own", () => {
    const original = firstMediaItem();
    const copy = mediaEntry(original) as any;

    expect(copy.uuid.string).not.toBe(original.uuid.string);
    expect(copy.cue.uuid.string).not.toBe(original.cue.uuid.string);
    expect(copy.cue.actions[0].uuid.string).not.toBe(original.cue.actions[0].uuid.string);

    // Everything else -- the file, its effects, its playback -- is the bin's.
    const withoutIds = (entry: any) => {
      const o = asObject(entry);
      delete o.uuid;
      delete o.cue.uuid;
      for (const a of o.cue.actions) delete a.uuid;
      return o;
    };
    expect(withoutIds(copy)).toEqual(withoutIds(original));
  });

  it("refuses an entry that is not media", () => {
    expect(() => mediaEntry(headerEntry("Chants"))).toThrow();
  });
});

describe("building and updating a presentation playlist", () => {
  it("creates one, fills it in order, and leaves the others alone", () => {
    const doc = decodePlaylistsDocument(syntheticPresentationFile()) as any;
    const uuid = "00000000-0000-4000-8000-0000000c0ffe";
    const song = presentationEntry({ path: "Libraries/Chants/Majeste.pro", location: MAC }) as any;

    const edited = applyOperations(doc, [
      { kind: "createPlaylist", uuid, name: "Mariage" },
      { kind: "insertItem", playlistUuid: uuid, itemName: "Chants", entry: headerEntry("Chants") },
      { kind: "insertItem", playlistUuid: uuid, itemName: "Fond", entry: mediaEntry(firstMediaItem()) },
      // At a position, not just the end.
      { kind: "insertItem", playlistUuid: uuid, itemName: "Majeste", entry: song, index: 1 },
      { kind: "renamePlaylist", playlistUuid: uuid, from: "Mariage", to: "Mariage (samedi)" },
    ]) as any;

    const created = edited.root_node.playlists.playlists.at(-1);
    expect(created.name).toBe("Mariage (samedi)");
    expect(rawItems(created).map((i: any) => Object.keys(asObject(i)).find((k) => k !== "uuid" && k !== "name"))).toEqual([
      "header",
      "presentation",
      "cue",
    ]);

    // The playlist that was already there is untouched, and so is the input.
    const Playlist = messageType("rv.data.Playlist");
    expect(Playlist.toObject(edited.root_node.playlists.playlists[0])).toEqual(
      Playlist.toObject(doc.root_node.playlists.playlists[0])
    );
    expect(doc.root_node.playlists.playlists).toHaveLength(1);

    // And it survives the wire as a presentation playlist.
    const again = decodePlaylistsDocument(encodeDocument(edited)) as any;
    expect(rawItems(again.root_node.playlists.playlists.at(-1))).toHaveLength(3);
  });
});

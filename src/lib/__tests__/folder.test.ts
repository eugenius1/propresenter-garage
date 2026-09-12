// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { afterEach, describe, expect, it, vi } from "vitest";
import { folderAccess, isPresentationFile, pickFolder, readFolderFromInput } from "../folder";

/**
 * A stand-in for a FileSystemDirectoryHandle.
 *
 * The picker itself opens a native dialog that cannot be driven from a test, so
 * what is verified here is everything after it: the walk, the filtering, the
 * skipped directories and the read/write wiring.
 */
function directory(name: string, entries: unknown[]): Record<string, unknown> {
  return {
    kind: "directory",
    name,
    values: async function* () {
      for (const entry of entries) yield entry;
    },
    requestPermission: async () => "granted",
  };
}

function file(name: string, contents: string): Record<string, unknown> {
  const written: string[] = [];
  return {
    kind: "file",
    name,
    written,
    getFile: async () => new File([contents], name),
    createWritable: async () => ({
      write: async (data: Uint8Array) => {
        written.push(new TextDecoder().decode(data));
      },
      close: async () => {},
    }),
  };
}

function stubPicker(root: unknown) {
  vi.stubGlobal("window", { showDirectoryPicker: async () => root });
}

afterEach(() => vi.unstubAllGlobals());

describe("walking a folder", () => {
  it("finds presentations nested under the workspace", async () => {
    stubPicker(
      directory("ProPresenter", [
        directory("Libraries", [
          file("Song.pro", "one"),
          file("Another.pro", "two"),
          file("notes.txt", "ignored"),
        ]),
        directory("Playlists", [file("Media", "not a presentation")]),
      ])
    );

    const folder = await pickFolder(isPresentationFile);
    expect(folder).not.toBeNull();
    expect(folder!.files.map((f) => f.path)).toEqual([
      "Libraries/Song.pro",
      "Libraries/Another.pro",
    ]);
  });

  it("skips the media directory, which holds no documents and is the largest", async () => {
    stubPicker(
      directory("ProPresenter", [
        directory("Media", [directory("Assets", [file("Trap.pro", "should not be read")])]),
        directory("Libraries", [file("Real.pro", "yes")]),
      ])
    );

    const folder = await pickFolder(isPresentationFile);
    expect(folder!.files.map((f) => f.name)).toEqual(["Real.pro"]);
  });

  it("reads a file's bytes on demand", async () => {
    stubPicker(directory("Libraries", [file("Song.pro", "hello")]));
    const folder = await pickFolder(isPresentationFile);
    expect(new TextDecoder().decode(await folder!.files[0].read())).toBe("hello");
  });

  it("exposes a writer when the handle supports one", async () => {
    stubPicker(directory("Libraries", [file("Song.pro", "before")]));
    const folder = await pickFolder(isPresentationFile);
    await folder!.files[0].write!(new TextEncoder().encode("after"));
    // Written through the handle, not to a copy.
    expect(folder!.files[0].write).toBeDefined();
  });

  it("asks for write permission only when writing is wanted", async () => {
    const root = directory("Libraries", [file("Song.pro", "x")]);
    const spy = vi.fn(async () => "granted");
    root.requestPermission = spy;
    stubPicker(root);

    await pickFolder(isPresentationFile);
    expect(spy).not.toHaveBeenCalled();

    const writable = await pickFolder(isPresentationFile, { write: true });
    expect(spy).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(writable!.writable).toBe(true);
  });

  it("returns null when the picker is dismissed", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
      },
    });
    await expect(pickFolder(isPresentationFile)).resolves.toBeNull();
  });

  it("passes a real failure on rather than swallowing it", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw new Error("something else went wrong");
      },
    });
    await expect(pickFolder(isPresentationFile)).rejects.toThrow("something else went wrong");
  });

  it("returns null where there is no picker at all", async () => {
    vi.stubGlobal("window", {});
    await expect(pickFolder(isPresentationFile)).resolves.toBeNull();
  });
});

describe("the directory-input fallback", () => {
  function listOf(paths: string[]): FileList {
    const files = paths.map((path) => {
      const f = new File(["x"], path.split("/").pop()!);
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    });
    return Object.assign(files, { item: (i: number) => files[i] }) as unknown as FileList;
  }

  it("strips the chosen folder from the reported paths", () => {
    const folder = readFolderFromInput(
      listOf(["ProPresenter/Libraries/Song.pro", "ProPresenter/Libraries/Other.pro"]),
      isPresentationFile
    );
    expect(folder.name).toBe("ProPresenter");
    expect(folder.files.map((f) => f.path)).toEqual(["Libraries/Song.pro", "Libraries/Other.pro"]);
  });

  it("skips media directories here too", () => {
    const folder = readFolderFromInput(
      listOf(["ProPresenter/Media/Assets/Trap.pro", "ProPresenter/Libraries/Real.pro"]),
      isPresentationFile
    );
    expect(folder.files.map((f) => f.name)).toEqual(["Real.pro"]);
  });

  it("is never writable, because these are copies", () => {
    // The input gives no route back to the original file on disk.
    const folder = readFolderFromInput(listOf(["Lib/Song.pro"]), isPresentationFile);
    expect(folder.writable).toBe(false);
    expect(folder.files[0].write).toBeUndefined();
  });
});

describe("capability detection", () => {
  it("reports read-write where the picker exists", () => {
    vi.stubGlobal("window", { showDirectoryPicker: () => {} });
    expect(folderAccess()).toBe("readwrite");
  });

  it("reports unavailable with no window at all", () => {
    // Node, and any other non-browser context.
    vi.stubGlobal("window", undefined);
    expect(folderAccess()).toBe("unavailable");
  });
});

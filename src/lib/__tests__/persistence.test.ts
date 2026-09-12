// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forget,
  forgetAll,
  handlePermission,
  keep,
  KEYS,
  remember,
  requestHandlePermission,
} from "../persistence";

beforeEach(async () => {
  await forgetAll();
});

describe("keeping things across a refresh", () => {
  it("returns null for something never kept", async () => {
    expect(await remember("nothing.here")).toBeNull();
  });

  it("keeps and returns a value", async () => {
    expect(await keep(KEYS.mediaBinBaseline, { filename: "Media", bytes: new Uint8Array([1, 2]) })).toBe(true);
    const back = await remember<{ filename: string; bytes: Uint8Array }>(KEYS.mediaBinBaseline);
    expect(back?.filename).toBe("Media");
    expect(Array.from(back!.bytes)).toEqual([1, 2]);
  });

  it("keeps binary intact, which is the whole point", async () => {
    // A structured clone, not a string: the bytes come back as bytes rather
    // than mangled through JSON or base64.
    const bytes = new Uint8Array(1024).map((_, i) => i % 256);
    await keep(KEYS.mediaBinCompare, { filename: "Media", bytes });
    const back = await remember<{ bytes: Uint8Array }>(KEYS.mediaBinCompare);
    expect(back!.bytes).toBeInstanceOf(Uint8Array);
    expect(back!.bytes.length).toBe(1024);
    expect(Array.from(back!.bytes.slice(0, 4))).toEqual([0, 1, 2, 3]);
  });

  it("replaces rather than accumulating", async () => {
    await keep(KEYS.mediaBinBaseline, { filename: "First" });
    await keep(KEYS.mediaBinBaseline, { filename: "Second" });
    expect((await remember<{ filename: string }>(KEYS.mediaBinBaseline))?.filename).toBe("Second");
  });

  it("forgets one value without touching the others", async () => {
    await keep(KEYS.mediaBinBaseline, { filename: "Baseline" });
    await keep(KEYS.mediaBinCompare, { filename: "Compare" });
    await forget(KEYS.mediaBinBaseline);
    expect(await remember(KEYS.mediaBinBaseline)).toBeNull();
    expect(await remember(KEYS.mediaBinCompare)).not.toBeNull();
  });

  it("forgets everything at once", async () => {
    await keep(KEYS.mediaBinBaseline, { filename: "a" });
    await keep(KEYS.presentationsFolder, { name: "b" });
    await forgetAll();
    expect(await remember(KEYS.mediaBinBaseline)).toBeNull();
    expect(await remember(KEYS.presentationsFolder)).toBeNull();
  });
});

describe("when storage is unavailable", () => {
  /**
   * Load the module with no IndexedDB at all.
   *
   * A fresh copy each time, because the module caches its connection: stubbing
   * the global after one has been opened proves nothing, and these tests
   * passed for the wrong reason until they did this.
   */
  async function withoutStorage() {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    return import("../persistence");
  }

  afterEach(() => vi.unstubAllGlobals());

  it("reads as empty rather than throwing", async () => {
    // Private windows, blocked site data, and policy all look like this.
    const storage = await withoutStorage();
    await expect(storage.remember("anything")).resolves.toBeNull();
  });

  it("reports a failed write instead of throwing", async () => {
    const storage = await withoutStorage();
    await expect(storage.keep("anything", 1)).resolves.toBe(false);
  });

  it("forgetting is harmless", async () => {
    const storage = await withoutStorage();
    await expect(storage.forget("anything")).resolves.toBeUndefined();
  });
});

describe("permission on a remembered folder", () => {
  it("reports what the handle says", async () => {
    const handle = { queryPermission: async () => "granted" as PermissionState };
    expect(await handlePermission(handle)).toBe("granted");
  });

  it("treats a handle that cannot be asked as needing a prompt", async () => {
    // An installed app often still holds permission; a plain tab often does
    // not. Either way the caller must offer a button rather than re-request
    // on load, since asking needs a user gesture.
    expect(await handlePermission({})).toBe("prompt");
  });

  it("treats a throwing handle as denied", async () => {
    const handle = {
      queryPermission: async () => {
        throw new Error("gone");
      },
    };
    expect(await handlePermission(handle)).toBe("denied");
  });

  it("re-requests through the handle", async () => {
    const spy = vi.fn(async () => "granted" as PermissionState);
    expect(await requestHandlePermission({ requestPermission: spy }, "readwrite")).toBe("granted");
    expect(spy).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  it("cannot re-request a handle that does not support it", async () => {
    expect(await requestHandlePermission({})).toBe("denied");
  });
});

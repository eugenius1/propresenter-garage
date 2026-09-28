import { afterEach, describe, expect, it, vi } from "vitest";
import { isTheme, resolveTheme, systemTheme, THEMES, watchSystemTheme } from "../theme";

/** Stand in for the browser's matchMedia, reporting a fixed preference. */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const stub = vi.fn(() => ({
    matches: prefersDark,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  }));
  vi.stubGlobal("matchMedia", stub);
  return {
    listenerCount: () => listeners.size,
    flip: (dark: boolean) =>
      listeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("theme resolution", () => {
  it("defaults to following the system", () => {
    // `system` first in the list is what makes it the default everywhere.
    expect(THEMES[0]).toBe("system");
  });

  it("resolves system to whatever the device reports", () => {
    stubMatchMedia(true);
    expect(systemTheme()).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");

    stubMatchMedia(false);
    expect(systemTheme()).toBe("light");
    expect(resolveTheme("system")).toBe("light");
  });

  it("lets an explicit choice override the system", () => {
    stubMatchMedia(true);
    expect(resolveTheme("light")).toBe("light");
    stubMatchMedia(false);
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("falls back to light where matchMedia is unavailable", () => {
    // Server-side rendering and older embedded webviews.
    vi.stubGlobal("matchMedia", undefined);
    expect(systemTheme()).toBe("light");
    expect(resolveTheme("system")).toBe("light");
  });

  it("rejects unknown stored values", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("solarized")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("following the system over time", () => {
  it("reports a change when the device preference flips", () => {
    // The point of a `system` setting: a booth machine that goes dark at
    // sundown should take the app with it, not stay on the value read at load.
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const stop = watchSystemTheme((resolved) => seen.push(resolved));

    media.flip(true);
    media.flip(false);
    expect(seen).toEqual(["dark", "light"]);

    stop();
    expect(media.listenerCount()).toBe(0);
  });

  it("unsubscribes cleanly where matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });
});

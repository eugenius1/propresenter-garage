// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { I18nProvider } from "../../i18n";

/**
 * jsdom has no matchMedia, and the real one cannot be told to change its mind.
 * This stands in for both, and exposes a way to flip the system preference so
 * the "keeps following" behaviour is actually observable.
 */
function stubMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = prefersDark;

  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  }));

  return {
    flip(dark: boolean) {
      matches = dark;
      listeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

const isDark = () => document.documentElement.classList.contains("dark");
const themeSelect = () =>
  screen.getAllByRole("combobox").find((s) =>
    [...(s as HTMLSelectElement).options].some((o) => o.textContent === "System")
  ) as HTMLSelectElement;

beforeEach(() => vi.unstubAllGlobals());

describe("ThemeSwitcher", () => {
  it("defaults to following the system", async () => {
    stubMatchMedia(true);
    render(
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    );

    await waitFor(() => expect(isDark()).toBe(true));
    expect(themeSelect().value).toBe("system");
    // Following the system is the default, not a stored choice.
    expect(localStorage.getItem("propresenter-garage.theme")).toBeNull();
  });

  it("keeps following after load when the system preference changes", async () => {
    // The behaviour that separates a real three-state theme from one that
    // reads the preference once: a machine going dark in the evening should
    // take the app with it.
    const media = stubMatchMedia(false);
    render(
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    );

    await waitFor(() => expect(isDark()).toBe(false));
    media.flip(true);
    await waitFor(() => expect(isDark()).toBe(true));
    media.flip(false);
    await waitFor(() => expect(isDark()).toBe(false));

    expect(themeSelect().value).toBe("system");
  });

  it("lets an explicit choice override the system, and remembers it", async () => {
    stubMatchMedia(false);
    render(
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    );

    await userEvent.selectOptions(themeSelect(), "dark");

    await waitFor(() => expect(isDark()).toBe(true));
    expect(localStorage.getItem("propresenter-garage.theme")).toBe("dark");
  });

  it("stops following the system once a choice is made", async () => {
    const media = stubMatchMedia(false);
    render(
      <I18nProvider>
        <ThemeSwitcher />
      </I18nProvider>
    );

    await userEvent.selectOptions(themeSelect(), "light");
    await waitFor(() => expect(media.listenerCount()).toBe(0));

    media.flip(true);
    expect(isDark()).toBe(false);
  });

  it("translates its options", async () => {
    stubMatchMedia(false);
    render(
      <I18nProvider>
        <ThemeSwitcher />
        <LanguageSwitcher />
      </I18nProvider>
    );

    expect(themeSelect()).toHaveTextContent("System");

    const language = screen
      .getAllByRole("combobox")
      .find((s) => [...(s as HTMLSelectElement).options].some((o) => o.textContent === "Français"))!;
    await userEvent.selectOptions(language, "Français");

    await waitFor(() => expect(screen.getByLabelText("Apparence")).toHaveTextContent("Système"));
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdatePrompt, type Registrar } from "../UpdatePrompt";
import { I18nProvider } from "../../i18n";

/**
 * A stand-in for the service worker registration.
 *
 * The real one comes from a virtual module the bundler supplies, which does
 * not exist under the test runner -- and waiting on a genuine worker to reach
 * the "waiting" state would be a slow way to test a banner. So the component
 * takes the registrar as a prop and the test drives the callbacks directly.
 */
function fakeRegistrar() {
  const update = vi.fn(async () => {});
  let announce: (() => void) | null = null;
  const register: Registrar = (options) => {
    announce = () => options.onNeedRefresh?.();
    return update;
  };
  return {
    register: () => Promise.resolve(register),
    update,
    /**
     * Throws until registration has happened, so `waitFor` waits for it
     * rather than passing on the first tick and announcing to nobody.
     */
    announce: () => {
      if (!announce) throw new Error("not registered yet");
      announce();
    },
  };
}

const show = (load: () => Promise<Registrar>) =>
  render(
    <I18nProvider>
      <UpdatePrompt load={load} />
    </I18nProvider>
  );

describe("the offer to load a new version", () => {
  it("says nothing until a new build is waiting", async () => {
    const sw = fakeRegistrar();
    show(sw.register);
    // Registration is asynchronous, so an empty render could simply be early.
    await waitFor(() => expect(sw.update).not.toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a reload once one is", async () => {
    const sw = fakeRegistrar();
    show(sw.register);
    await waitFor(() => sw.announce());
    expect(await screen.findByRole("status")).toHaveTextContent("new version is available");
  });

  it("applies the waiting worker and reloads when asked", async () => {
    const sw = fakeRegistrar();
    show(sw.register);
    await waitFor(() => sw.announce());
    await userEvent.click(await screen.findByRole("button", { name: "Reload" }));
    // `true` is what actually reloads the page once the worker takes over;
    // without it the new build is installed but never shown.
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it("can be dismissed, leaving the current version running", async () => {
    const sw = fakeRegistrar();
    show(sw.register);
    await waitFor(() => sw.announce());
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it("stays quiet when there is no service worker at all", async () => {
    // Development, and any browser that refuses to register one.
    show(async () => null as unknown as Registrar);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});

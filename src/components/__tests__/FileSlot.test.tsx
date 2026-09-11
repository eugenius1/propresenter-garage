// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileSlot } from "../FileSlot";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { I18nProvider } from "../../i18n";
import { syntheticMediaFile, syntheticPresentationFile } from "../../lib/__tests__/synthetic";

function renderSlot(overrides: Partial<Parameters<typeof FileSlot>[0]> = {}) {
  const onLoad = vi.fn();
  const onClear = vi.fn();
  const view = render(
    <I18nProvider>
      {/* The switcher is rendered alongside so a test can change language the
          way a reader does, rather than by reaching into the provider. */}
      <LanguageSwitcher />
      <FileSlot
        role="Baseline"
        hint="Drop your Media file here"
        wrongKindHint='Pick the file named "Media" from your ProPresenter folder.'
        file={null}
        onLoad={onLoad}
        onClear={onClear}
        {...overrides}
      />
    </I18nProvider>
  );
  return { onLoad, onClear, unmount: view.unmount };
}

function fileOf(bytes: Uint8Array, name: string) {
  return new File([bytes as BlobPart], name, { type: "application/octet-stream" });
}

/**
 * Change language the way a reader does.
 *
 * Located by its options rather than its label, because the label is itself
 * translated -- it reads "Langue" once French is active.
 */
function languageSelect(): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const found = selects.find((s) =>
    [...s.options].some((o) => o.textContent === "Français")
  );
  if (!found) throw new Error("no language select rendered");
  return found;
}

const switchLanguage = (to: string) => userEvent.selectOptions(languageSelect(), to);

describe("FileSlot", () => {
  it("accepts a media file and reports it upward", async () => {
    const { onLoad } = renderSlot();

    await userEvent.upload(
      document.querySelector("input[type=file]")!,
      fileOf(syntheticMediaFile(), "Media")
    );

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    const loaded = onLoad.mock.calls[0][0];
    expect(loaded.filename).toBe("Media");
    expect(loaded.library.items.length).toBeGreaterThan(0);
    expect(loaded.exportSafe).toBe(true);
  });

  it("rejects a file that is not protobuf at all", async () => {
    const { onLoad } = renderSlot();

    await userEvent.upload(
      document.querySelector("input[type=file]")!,
      fileOf(new Uint8Array([0x3c, 0x78, 0x6d, 0x6c, 0xff, 0xfe]), "NotAPlaylist")
    );

    expect(await screen.findByText(/Not a ProPresenter playlist file/)).toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("names both kinds and adds the tool's hint when the kind is wrong", async () => {
    renderSlot();
    await userEvent.upload(
      document.querySelector("input[type=file]")!,
      fileOf(syntheticPresentationFile(), "Library")
    );

    const message = await screen.findByText(/presentation playlist/);
    expect(message).toHaveTextContent(
      "This is a presentation playlist, not a media playlist."
    );
    // The shared error knows the kinds; only the tool knows which file it wanted.
    expect(message).toHaveTextContent('Pick the file named "Media"');
  });

  it("re-renders a rejection in the newly chosen language", async () => {
    // The regression: the message used to be formatted once and stored, so it
    // stayed in whichever language was active when the file was rejected.
    renderSlot();

    await userEvent.upload(
      document.querySelector("input[type=file]")!,
      fileOf(new Uint8Array([0x3c, 0x78, 0x6d, 0x6c, 0xff, 0xfe]), "NotAPlaylist")
    );
    expect(await screen.findByText(/Not a ProPresenter playlist file/)).toBeInTheDocument();

    await switchLanguage("Français");
    expect(await screen.findByText(/Ce n'est pas un fichier de liste ProPresenter/)).toBeInTheDocument();
    expect(screen.queryByText(/Not a ProPresenter playlist file/)).not.toBeInTheDocument();

    await switchLanguage("English");
    expect(await screen.findByText(/Not a ProPresenter playlist file/)).toBeInTheDocument();
  });

  it("shows a loaded file's details, and translates them too", async () => {
    const first = renderSlot();
    await userEvent.upload(
      document.querySelector("input[type=file]")!,
      fileOf(syntheticMediaFile(), "Media")
    );
    await waitFor(() => expect(first.onLoad).toHaveBeenCalled());

    // Re-render with the file the slot just produced, from a clean tree.
    const loaded = first.onLoad.mock.calls[0][0];
    first.unmount();
    renderSlot({ file: loaded });

    expect(await screen.findByText("lossless")).toBeInTheDocument();
    expect(screen.getByText(/13 items/)).toBeInTheDocument();

    await switchLanguage("Français");
    expect(await screen.findByText("sans perte")).toBeInTheDocument();
    expect(screen.getByText(/13 éléments/)).toBeInTheDocument();
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReorganiseView } from "../ReorganiseView";
import { I18nProvider } from "../../i18n";
import { loadMediaFile, type LoadedFile } from "../../lib/loadFile";
import { checkFidelity } from "../../lib/decode";
import { buildLibrary, decodeMediaDocument } from "../../lib/model";
import { syntheticMediaFile } from "../../lib/__tests__/synthetic";

async function loadSynthetic(): Promise<LoadedFile> {
  return loadMediaFile(
    new File([syntheticMediaFile() as BlobPart], "Media", { type: "application/octet-stream" })
  );
}

function renderView(file: LoadedFile) {
  return render(
    <I18nProvider>
      <ReorganiseView file={file} />
    </I18nProvider>
  );
}

/** Capture what the export hands the browser, instead of downloading it. */
function captureDownload() {
  const captured: { name?: string; blob?: Blob } = {};
  const realCreate = URL.createObjectURL;

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      captured.blob = blob;
      return "blob:captured";
    },
    revokeObjectURL: () => {},
  });

  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      captured.name = this.download;
    });

  return {
    captured,
    restore: () => {
      clickSpy.mockRestore();
      vi.stubGlobal("URL", { ...URL, createObjectURL: realCreate });
    },
  };
}

beforeEach(() => vi.unstubAllGlobals());

describe("ReorganiseView", () => {
  it("starts with nothing queued and export unavailable", async () => {
    renderView(await loadSynthetic());

    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo last" })).toBeDisabled();
  });

  it("queues a quick fix and summarises it with the diff engine", async () => {
    const file = await loadSynthetic();
    renderView(file);

    // The fixture holds one duplicate: the same file twice in one playlist,
    // with identical modifications.
    await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));

    expect(await screen.findByText("1 pending change")).toBeInTheDocument();
    const summary = screen.getByText("Removed").closest(".stat")!;
    expect(within(summary).getByText("1")).toBeInTheDocument();
  });

  it("stops offering a fix once it has been applied", async () => {
    renderView(await loadSynthetic());

    await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));
    await userEvent.click(screen.getByRole("button", { name: /Remove 1 empty playlist/ }));

    // Quick fixes re-derive from the edited library, not the loaded one.
    expect(
      await screen.findByText("The audit found nothing to fix automatically.")
    ).toBeInTheDocument();
  });

  it("undoes one change at a time, and discards all at once", async () => {
    renderView(await loadSynthetic());

    await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));
    await userEvent.click(screen.getByRole("button", { name: /Remove 1 empty playlist/ }));
    expect(await screen.findByText("2 pending changes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo last" }));
    expect(await screen.findByText("1 pending change")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Discard all" }));
    expect(await screen.findByText("No changes yet.")).toBeInTheDocument();
  });

  it("exports a differently-named file that is still a valid media document", async () => {
    const file = await loadSynthetic();
    const { captured, restore } = captureDownload();

    try {
      renderView(file);
      await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));
      await userEvent.click(screen.getByRole("button", { name: "Export file" }));

      await waitFor(() => expect(captured.name).toBeTruthy());

      // Never the original name: overwriting ProPresenter's own file is how a
      // library gets destroyed.
      expect(captured.name).not.toBe("Media");
      expect(captured.name).toMatch(/^Media-edited-\d{8}-\d{4}$/);

      const bytes = new Uint8Array(await captured.blob!.arrayBuffer());
      expect(checkFidelity(bytes).fidelity).toBe("identical");

      const exported = buildLibrary(decodeMediaDocument(bytes));
      expect(exported.items.length).toBe(file.library.items.length - 1);
    } finally {
      restore();
    }
  });

  it("confirms the export, naming the file it wrote", async () => {
    const { captured, restore } = captureDownload();
    try {
      renderView(await loadSynthetic());
      await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));
      await userEvent.click(screen.getByRole("button", { name: "Export file" }));

      await waitFor(() => expect(captured.name).toBeTruthy());
      expect(
        await screen.findByText(new RegExp(`Exported as ${captured.name}`))
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("refuses to export a file that would lose content", async () => {
    const file = await loadSynthetic();
    // A lossy file is one the reverse-engineered schema does not fully cover.
    // None exists to hand, so the verdict is forced.
    renderView({ ...file, exportSafe: false, fidelity: "lossy" });

    await userEvent.click(screen.getByRole("button", { name: /Remove 1 duplicate entry/ }));

    expect(screen.getByRole("button", { name: "Export file" })).toBeDisabled();
    expect(
      screen.getByText(/cannot be exported: re-encoding it loses content/)
    ).toBeInTheDocument();
  });

  it("renames an item through the tree", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Renamed By Test");
    renderView(await loadSynthetic());

    // Open the first playlist and rename its first item.
    const renameButtons = screen.getAllByRole("button", { name: "Rename" });
    await userEvent.click(renameButtons[renameButtons.length - 1]);

    expect(await screen.findByText("1 pending change")).toBeInTheDocument();
    const summary = screen.getByText("Renamed").closest(".stat")!;
    expect(within(summary).getByText("1")).toBeInTheDocument();
  });
});

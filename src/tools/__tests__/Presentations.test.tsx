// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/** @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Presentations } from "../Presentations";
import { I18nProvider } from "../../i18n";
import { checkPresentation, decodePresentation, readPresentation } from "../../lib/presentation";
import { syntheticTextPresentation } from "../../lib/__tests__/synthetic";
import type { FolderAccess, PickedFolder } from "../../lib/folder";

/**
 * A folder held in memory, standing in for one on disk.
 *
 * The interesting behaviour is the gating -- what is offered, when, and what
 * finally reaches the folder -- and none of it needs a real directory handle.
 */
const store = new Map<string, Uint8Array>();
let access: FolderAccess = "readwrite";
let writable = true;

function fakeFolder(): PickedFolder {
  return {
    name: "Libraries",
    writable,
    handle: writable ? { name: "Libraries" } : undefined,
    files: [...store.keys()].map((path) => ({
      path,
      name: path.split("/").pop()!,
      size: 0,
      read: async () => store.get(path)!,
      write: writable ? async (bytes: Uint8Array) => void store.set(path, bytes) : undefined,
    })),
  };
}

vi.mock("../../lib/folder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/folder")>()),
  folderAccess: () => access,
  pickFolder: async () => fakeFolder(),
}));

vi.mock("../../lib/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/persistence")>()),
  requestHandlePermission: async () => "granted" as PermissionState,
}));

/** Capture what a download hands the browser, instead of downloading it. */
function captureDownloads() {
  const captured: { name: string; blob: Blob }[] = [];
  let pending: Blob | undefined;
  const realCreate = URL.createObjectURL;

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      pending = blob;
      return "blob:captured";
    },
    revokeObjectURL: () => {},
  });

  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      captured.push({ name: this.download, blob: pending! });
    });

  return { captured, restore: () => click.mockRestore() };
}

const issuesIn = (bytes: Uint8Array) =>
  checkPresentation("x", readPresentation(decodePresentation(bytes))).issues;

function renderTool() {
  return render(
    <I18nProvider>
      <Presentations />
    </I18nProvider>
  );
}

/** Choose the folder and wait for the scan to settle. */
async function openFolder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Choose a folder/ }));
  await screen.findByRole("heading", { name: "Fix these" });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  access = "readwrite";
  writable = true;
  store.clear();
  store.set("Chants/Checked Song.pro", syntheticTextPresentation());
});

afterEach(() => vi.restoreAllMocks());

describe("finding and showing fixes", () => {
  it("shows each line as it is and as it would read", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    // A leading space, shown as a dot, and the line without it.
    expect(screen.getByText("·leading space")).toBeInTheDocument();
    expect(screen.getByText("leading space")).toBeInTheDocument();
    // A blank line is removed rather than rewritten.
    expect(screen.getByText("the line is removed")).toBeInTheDocument();
  });

  it("gathers several findings on one line into one decision", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    // Four findings in the fixture, on four separate lines.
    expect(screen.getByRole("button", { name: "Fix 4 lines" })).toBeInTheDocument();
  });

  it("follows the filters", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    await user.click(screen.getByRole("button", { name: /^Leading space/ }));
    await user.click(screen.getByRole("button", { name: /^Trailing space/ }));
    await user.click(screen.getByRole("button", { name: /^Double space/ }));

    // Only the blank line is left showing, so only it is offered.
    expect(await screen.findByRole("button", { name: "Fix 1 line" })).toBeInTheDocument();
  });
});

describe("the guard before anything is written", () => {
  it("will not save until a backup has been taken", async () => {
    const user = userEvent.setup();
    const original = store.get("Chants/Checked Song.pro")!;
    renderTool();
    await openFolder(user);

    expect(screen.getByRole("button", { name: "Fix 4 lines" })).toBeDisabled();
    expect(store.get("Chants/Checked Song.pro")).toBe(original);
  });

  it("backs up the files as they stand, then saves", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    const original = store.get("Chants/Checked Song.pro")!;
    expect(issuesIn(original)).not.toHaveLength(0);

    renderTool();
    await openFolder(user);

    await user.click(screen.getByRole("button", { name: /Download a backup/ }));
    await waitFor(() => expect(downloads.captured).toHaveLength(1));
    expect(downloads.captured[0].name).toMatch(/^propresenter-backup-\d{8}-\d{4}\.zip$/);
    // The archive holds the file as it was, before anything was written.
    expect(downloads.captured[0].blob.size).toBeGreaterThan(0);
    expect(store.get("Chants/Checked Song.pro")).toBe(original);

    const save = await screen.findByRole("button", { name: "Fix 4 lines" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await screen.findByText("1 file fixed");
    const written = store.get("Chants/Checked Song.pro")!;
    expect(written).not.toBe(original);
    // Everything the reader was shown is gone. The trailing commas remain
    // because that check is off by default, which is the point of it being
    // off: nothing is fixed that was never reported.
    expect(issuesIn(written).map((i) => i.kind)).toEqual(["trailingComma", "trailingComma"]);

    downloads.restore();
  });

  it("asks for the backup again once the selection outgrows it", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    store.set("Chants/Second.pro", syntheticTextPresentation());

    renderTool();
    await openFolder(user);

    // Back up with one file deselected, then put it back in.
    const perFile = screen.getAllByRole("checkbox", { name: /Select every line/ });
    await user.click(perFile[1]);
    await user.click(screen.getByRole("button", { name: /Download a backup/ }));
    await waitFor(() => expect(downloads.captured).toHaveLength(1));

    await user.click(perFile[1]);
    expect(await screen.findByRole("button", { name: /^Fix 8 lines/ })).toBeDisabled();
    expect(
      screen.getByText(/selection now covers files the backup does not/)
    ).toBeInTheDocument();

    downloads.restore();
  });

  it("writes only the lines left ticked", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    renderTool();
    await openFolder(user);

    // Leave one line out of the run.
    await user.click(screen.getByRole("checkbox", { name: "slide 2 line 2" }));
    expect(await screen.findByRole("button", { name: "Fix 3 lines" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Download a backup/ }));
    await user.click(await screen.findByRole("button", { name: "Fix 3 lines" }));

    await screen.findByText("1 file fixed");
    const kinds = issuesIn(store.get("Chants/Checked Song.pro")!).map((i) => i.kind);
    // The line left unticked is untouched; so are the commas nobody asked for.
    expect(kinds).toEqual(["leadingSpace", "trailingComma", "trailingComma"]);

    downloads.restore();
  });
});

describe("a browser that cannot write", () => {
  // The folder came back without a handle, which is what the picker fallback
  // and the directory input both leave behind: files that can be read and no
  // way back to the originals.
  beforeEach(() => {
    writable = false;
  });

  it("hands over fixed copies and leaves the library alone", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    const original = store.get("Chants/Checked Song.pro")!;

    renderTool();
    await openFolder(user);

    // No backup is asked for, because nothing is about to be overwritten.
    expect(screen.queryByRole("button", { name: /Download a backup/ })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot write to the folder/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download the fixed files" }));
    await waitFor(() => expect(downloads.captured).toHaveLength(1));

    expect(downloads.captured[0].name).toMatch(/^propresenter-fixed-\d{8}-\d{4}\.zip$/);
    expect(downloads.captured[0].blob.size).toBeGreaterThan(0);
    expect(await screen.findByText(/has not been touched/)).toBeInTheDocument();

    // The library is exactly as it was: the findings are all still there.
    expect(store.get("Chants/Checked Song.pro")).toBe(original);
    expect(issuesIn(original)).not.toHaveLength(0);

    downloads.restore();
  });
});

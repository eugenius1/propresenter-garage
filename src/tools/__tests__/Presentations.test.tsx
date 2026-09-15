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
/** Set by a test that wants to watch a run part-way through. */
let beforeRead: ((path: string) => Promise<void>) | null = null;

function fakeFolder(): PickedFolder {
  return {
    name: "Libraries",
    writable,
    handle: writable ? { name: "Libraries" } : undefined,
    files: [...store.keys()].map((path) => ({
      path,
      name: path.split("/").pop()!,
      size: 0,
      read: async () => {
        await beforeRead?.(path);
        return store.get(path)!;
      },
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
  beforeRead = null;
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

describe("the opt-in checks", () => {
  it("offers one switch per mark, all off to begin with", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    for (const label of [
      "Also look for trailing commas",
      "Also look for trailing semicolons",
      "Also look for trailing full stops",
    ]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeChecked();
    }
    // Nothing punctuation-related is reported until one is asked for.
    expect(screen.queryByRole("button", { name: /^Trailing full stop/ })).not.toBeInTheDocument();
  });

  it("shows only the mark that was switched on", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    await user.click(screen.getByRole("checkbox", { name: "Also look for trailing full stops" }));

    expect(await screen.findByRole("button", { name: "Trailing full stop 1" })).toBeInTheDocument();
    // The comma check is a separate decision and stays off.
    expect(screen.queryByRole("button", { name: /^Trailing comma/ })).not.toBeInTheDocument();
    // One more line to fix than before, and it is the full stop.
    expect(screen.getByRole("button", { name: "Fix 5 lines" })).toBeInTheDocument();
    expect(screen.getByText("je te loue")).toBeInTheDocument();
  });

  it("leaves a line ending in an ellipsis alone", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    await user.click(screen.getByRole("checkbox", { name: "Also look for trailing full stops" }));
    await screen.findByRole("button", { name: "Trailing full stop 1" });

    // Both spellings are in the fixture and neither is a finding.
    expect(screen.queryByText(/chanterai/)).not.toBeInTheDocument();
    expect(screen.queryByText("Gloire...")).not.toBeInTheDocument();
  });
});

describe("the order files are listed in", () => {
  /**
   * The file headings, in the order they appear on screen.
   *
   * The count badge lives inside the heading, so it is dropped by element
   * rather than by stripping trailing digits -- which would also eat the 9 in
   * "Psaume 9".
   */
  const headings = () =>
    screen.getAllByRole("heading", { level: 3 }).map((h) =>
      [...h.childNodes]
        .filter((n) => !(n instanceof Element && n.classList.contains("count-badge")))
        .map((n) => n.textContent)
        .join("")
    );

  /** A file whose presentation name differs from its path, as real ones do. */
  const put = (path: string, name: string) => store.set(path, syntheticTextPresentation(name));

  it("sorts by the name on screen, not by whatever the folder handed back", async () => {
    store.clear();
    put("Chants/zzz-01.pro", "Zacharie");
    put("Chants/aaa-02.pro", "Merveilleux");
    put("Chants/mmm-03.pro", "Acclamons");

    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    // Alphabetical by the heading, which is the presentation's own name --
    // sorting by the filename would have produced exactly the reverse.
    expect(headings()).toEqual(["Acclamons", "Merveilleux", "Zacharie"]);
  });

  it("ignores accents when sorting, and counts numbers as numbers", async () => {
    // A French library sorts "Élever" beside "Elever", not after "Z", and
    // "Psaume 9" comes before "Psaume 10" rather than after it.
    store.clear();
    for (const name of ["Psaume 10", "Zacharie", "Psaume 9", "Élever"]) {
      put(`Chants/${name}.pro`, name);
    }

    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    expect(headings()).toEqual(["Élever", "Psaume 9", "Psaume 10", "Zacharie"]);
  });

  it("puts two songs of the same name in a settled order", async () => {
    store.clear();
    put("Noël/Acclamons.pro", "Acclamons");
    put("Chants/Acclamons.pro", "Acclamons");

    const user = userEvent.setup();
    const view = renderTool();
    await openFolder(user);

    // The names tie, so the path decides -- and the path is what tells them
    // apart on screen.
    expect([...view.container.querySelectorAll(".finding-folder")].map((e) => e.textContent)).toEqual([
      "Libraries/Chants",
      "Libraries/Noël",
    ]);
  });

  it("names the folder only when the files are not all in one", async () => {
    store.clear();
    put("Chants/Acclamons.pro", "Acclamons");
    put("Chants/Zacharie.pro", "Zacharie");

    const user = userEvent.setup();
    const view = renderTool();
    await openFolder(user);
    expect(view.container.querySelector(".finding-folder")).toBeNull();

    put("Noël/Merveilleux.pro", "Merveilleux");
    await user.click(screen.getByRole("button", { name: "Change" }));
    await waitFor(() =>
      expect(
        [...view.container.querySelectorAll(".finding-folder")].map((e) => e.textContent)
      ).toEqual(["Libraries/Chants", "Libraries/Noël", "Libraries/Chants"])
    );
  });

  it("names an unreadable file by its own name, not its whole path", async () => {
    store.clear();
    store.set("Chants/Broken.pro", new Uint8Array([0x3c, 0xff, 0xfe]));
    put("Noël/Zacharie.pro", "Zacharie");

    const user = userEvent.setup();
    renderTool();
    await openFolder(user);

    // The folder is named once, beside the heading -- not again inside it.
    expect(headings()[0]).toBe("Libraries/ChantsBroken.pro");
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
    // Everything the reader was shown is gone. The trailing punctuation
    // remains because those checks are off by default, which is the point of
    // them being off: nothing is fixed that was never reported.
    expect(issuesIn(written).map((i) => i.kind)).toEqual([
      "trailingComma",
      "trailingComma",
      "trailingSemicolon",
      "trailingFullStop",
    ]);

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
    // The line left unticked is untouched; so is the punctuation nobody asked
    // for.
    expect(kinds).toEqual([
      "leadingSpace",
      "trailingComma",
      "trailingComma",
      "trailingSemicolon",
      "trailingFullStop",
    ]);

    downloads.restore();
  });
});

describe("showing how far a run has got", () => {
  const bar = () => screen.queryByRole("progressbar");

  /**
   * Reads that do not resolve until they are let go, one at a time.
   *
   * The whole point of a progress bar is the state part-way through, and fakes
   * that resolve straight away would only ever show it finished.
   */
  function holdReads() {
    const waiting: (() => void)[] = [];
    beforeRead = () => new Promise<void>((resolve) => waiting.push(resolve));
    return {
      /** Let the file currently being read through. */
      next: async () => {
        await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
        waiting.shift()!();
      },
      release: () => {
        beforeRead = null;
        for (const resolve of waiting.splice(0)) resolve();
      },
    };
  }

  beforeEach(() => {
    store.clear();
    // Named so they sort Deux, Trois, Un -- the order the run works through.
    for (const name of ["Un", "Deux", "Trois"]) {
      store.set(`Chants/${name}.pro`, syntheticTextPresentation(name));
    }
  });

  it("shows nothing until a run starts", async () => {
    const user = userEvent.setup();
    renderTool();
    await openFolder(user);
    expect(bar()).not.toBeInTheDocument();
  });

  it("counts files finished, naming the one it is on", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    renderTool();
    await openFolder(user);

    const held = holdReads();
    await user.click(screen.getByRole("button", { name: /Download a backup/ }));

    // Nothing finished yet, and the caption names the file being read.
    await waitFor(() => expect(bar()).toBeInTheDocument());
    expect(bar()).toHaveAttribute("aria-valuenow", "0");
    expect(bar()).toHaveAttribute("aria-valuemax", "3");
    expect(bar()).toHaveAttribute("aria-valuetext", "0 of 3");
    expect(screen.getByText("Backing up Chants/Deux.pro…")).toBeInTheDocument();

    await held.next();
    await waitFor(() => expect(bar()).toHaveAttribute("aria-valuenow", "1"));
    expect(screen.getByText("Backing up Chants/Trois.pro…")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await held.next();
    await waitFor(() => expect(bar()).toHaveAttribute("aria-valuenow", "2"));

    held.release();
    await waitFor(() => expect(downloads.captured).toHaveLength(1));
    // Gone once there is nothing left to report.
    await waitFor(() => expect(bar()).not.toBeInTheDocument());

    downloads.restore();
  });

  it("never runs ahead of the work", async () => {
    // The bar counts files finished, not files started: a bar that reached the
    // end while the last file was still being written would be a lie at
    // exactly the moment it matters.
    const user = userEvent.setup();
    const downloads = captureDownloads();
    renderTool();
    await openFolder(user);

    const held = holdReads();
    await user.click(screen.getByRole("button", { name: /Download a backup/ }));
    await waitFor(() => expect(bar()).toBeInTheDocument());

    for (const expected of ["0", "1", "2"]) {
      await waitFor(() => expect(bar()).toHaveAttribute("aria-valuenow", expected));
      const fill = document.querySelector(".progress-fill") as HTMLElement;
      expect(fill.style.width).not.toBe("100%");
      await held.next();
    }

    held.release();
    await waitFor(() => expect(downloads.captured).toHaveLength(1));
    downloads.restore();
  });

  it("says what it is doing, which is not the same in every phase", async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    renderTool();
    await openFolder(user);

    await user.click(screen.getByRole("button", { name: /Download a backup/ }));
    await waitFor(() => expect(downloads.captured).toHaveLength(1));

    const held = holdReads();
    await user.click(await screen.findByRole("button", { name: /^Fix / }));

    // Writing back into the folder is a different phase from backing up, and
    // says so.
    await waitFor(() => expect(screen.getByText(/^Saving /)).toBeInTheDocument());
    expect(screen.queryByText(/^Backing up /)).not.toBeInTheDocument();

    held.release();
    await screen.findByText("3 files fixed");
    expect(bar()).not.toBeInTheDocument();

    downloads.restore();
  });

  it("reports the run that hands over a zip instead", async () => {
    writable = false;
    const user = userEvent.setup();
    const downloads = captureDownloads();
    renderTool();
    await openFolder(user);

    const held = holdReads();
    await user.click(screen.getByRole("button", { name: "Download the fixed files" }));

    await waitFor(() => expect(screen.getByText(/^Fixing /)).toBeInTheDocument());
    expect(bar()).toHaveAttribute("aria-valuemax", "3");

    held.release();
    await waitFor(() => expect(downloads.captured).toHaveLength(1));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());

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

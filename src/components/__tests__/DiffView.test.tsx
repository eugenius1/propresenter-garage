/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffView } from "../DiffView";
import { I18nProvider } from "../../i18n";
import { encodeDocument } from "../../lib/decode";
import { diffLibraries } from "../../lib/diff";
import { loadMediaBytes, type LoadedFile } from "../../lib/loadFile";
import { decodeMediaDocument } from "../../lib/model";
import { syntheticMediaFile } from "../../lib/__tests__/synthetic";

/** The synthetic library, and a copy with one item renamed and one removed. */
function pair(): { baseline: LoadedFile; compare: LoadedFile } {
  const bytes = syntheticMediaFile();
  const doc = decodeMediaDocument(bytes);
  const withItems: any[] = [];
  (function walk(node: any) {
    if (node.items?.items?.length) withItems.push(node);
    for (const child of node.playlists?.playlists ?? node.children ?? []) walk(child);
  })(doc.root_node);
  withItems[0].items.items[0].name = "Renamed On The Right";
  withItems[1].items.items.splice(0, 1);
  return {
    baseline: loadMediaBytes("Media", bytes),
    compare: loadMediaBytes("Media copy", encodeDocument(doc)),
  };
}

function renderPair() {
  const { baseline, compare } = pair();
  const diff = diffLibraries(baseline.library, compare.library);
  render(
    <I18nProvider>
      <DiffView diff={diff} baseline={baseline} compare={compare} />
    </I18nProvider>
  );
  return diff;
}

afterEach(() => vi.restoreAllMocks());

describe("DiffView", () => {
  it("filters the list by type", async () => {
    renderPair();
    const changes = () => document.querySelectorAll("li.change").length;
    expect(changes()).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: /^Renamed/ }));
    expect(changes()).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: /^Renamed/ }));
    expect(changes()).toBe(2);
  });

  it("keeps a selection by its place in the diff when the list is filtered", async () => {
    renderPair();
    const rename = screen.getByRole("checkbox", { name: /^Renamed: Renamed On The Right/ });
    await userEvent.click(rename);
    expect(rename).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /^Removed/ }));
    expect(screen.getByRole("checkbox", { name: /^Renamed: / })).toBeChecked();

    await userEvent.click(screen.getByRole("checkbox", { name: /^Renamed: / }));
    expect(screen.getByRole("checkbox", { name: /^Renamed: / })).not.toBeChecked();
  });

  it("exports the merged file under a new name", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:captured");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderPair();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Renamed: / }));
    await userEvent.click(screen.getByRole("button", { name: "Apply and export" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^Exported as /)).toBeInTheDocument();
  });
});

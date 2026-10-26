/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditView } from "../AuditView";
import { I18nProvider } from "../../i18n";
import { auditLibrary } from "@propresenter-garage/core/lib/audit";
import { buildLibrary, decodeMediaDocument } from "@propresenter-garage/core/lib/model";
import { syntheticMediaFile } from "@propresenter-garage/core/lib/__tests__/synthetic";

describe("AuditView", () => {
  it("shows each finding the library has, with its count, and none it does not", () => {
    const lib = buildLibrary(decodeMediaDocument(syntheticMediaFile()));
    const audit = auditLibrary(lib);
    const { container } = render(
      <I18nProvider>
        <AuditView audit={audit} lib={lib} />
      </I18nProvider>
    );

    const shown = [...container.querySelectorAll(".finding")].map((el) => el.id);
    expect(shown).toEqual([
      "finding-withinPlaylist",
      "finding-crossPlaylist",
      "finding-variants",
      "finding-locations",
      "finding-external",
      "finding-empty",
      "finding-hidden",
    ]);

    const within = container.querySelector("#finding-withinPlaylist .count-badge")!;
    expect(within.className).toContain("warn");
    expect(within.textContent).toBe(String(audit.withinPlaylistDuplicates.length));
    expect(container.querySelector("#finding-variants .count-badge")!.className).not.toContain("warn");
  });
});

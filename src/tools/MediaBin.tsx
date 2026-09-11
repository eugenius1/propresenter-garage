// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useMemo, useState } from "react";
import { FileSlot } from "../components/FileSlot";
import { DiffView } from "../components/DiffView";
import { AuditView } from "../components/AuditView";
import { TreeView } from "../components/TreeView";
import { ReorganiseView } from "../components/ReorganiseView";
import { auditLibrary } from "../lib/audit";
import { diffLibraries } from "../lib/diff";
import type { LoadedFile } from "../lib/loadFile";
import { useI18n } from "../i18n";

type Tab = "diff" | "audit" | "browse" | "reorganise";

/**
 * The Media Bin tool: compare and audit media-bin playlists.
 *
 * Owns its own state. The shell above knows only which tool is showing, so a
 * second tool can arrive without either of them growing a union of the other's
 * concerns.
 */
export function MediaBin() {
  const { t } = useI18n();
  const [left, setLeft] = useState<LoadedFile | null>(null);
  const [right, setRight] = useState<LoadedFile | null>(null);
  const [tab, setTab] = useState<Tab>("audit");
  const [auditSide, setAuditSide] = useState<"left" | "right">("left");

  const diff = useMemo(
    () => (left && right ? diffLibraries(left.library, right.library) : null),
    [left, right]
  );

  const inspected = auditSide === "right" && right ? right : left;
  const audit = useMemo(() => (inspected ? auditLibrary(inspected.library) : null), [inspected]);

  // The file this tool wants, named so a wrong-kind error can say so.
  const wrongKindHint = t.tools.mediaBin.pickFileHint;

  function loadLeft(file: LoadedFile) {
    setLeft(file);
    setTab(right ? "diff" : "audit");
  }
  function loadRight(file: LoadedFile) {
    setRight(file);
    if (left) setTab("diff");
  }

  return (
    <>
      <div className="slots">
        <FileSlot
          role={t.tools.mediaBin.baseline}
          hint={t.tools.mediaBin.baselineHint}
          wrongKindHint={wrongKindHint}
          file={left}
          onLoad={loadLeft}
          onClear={() => { setLeft(null); setTab("audit"); }}
        />
        <FileSlot
          role={t.tools.mediaBin.compare}
          hint={t.tools.mediaBin.compareHint}
          wrongKindHint={wrongKindHint}
          file={right}
          onLoad={loadRight}
          onClear={() => { setRight(null); setTab("audit"); }}
        />
      </div>

      {!left && !right ? (
        <div className="card">
          <div className="empty-state">
            <strong>{t.tools.mediaBin.startHeading}</strong>
            {t.tools.mediaBin.whereWindows}{" "}
            <span className="mono">Documents\ProPresenter\Media</span>,{" "}
            {t.tools.mediaBin.whereMac}{" "}
            <span className="mono">~/Documents/ProPresenter/Media</span>.{" "}
            {t.tools.mediaBin.noExtension}
            <p style={{ marginTop: 14 }}>{t.tools.mediaBin.oneOrTwo}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "diff"}
              disabled={!diff}
              onClick={() => setTab("diff")}
              title={diff ? undefined : t.tools.mediaBin.diffDisabled}
            >
              {t.tools.mediaBin.tabs.diff}
              {diff ? ` (${diff.changes.length})` : ""}
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "audit"}
              onClick={() => setTab("audit")}
            >
              {t.tools.mediaBin.tabs.audit}
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "browse"}
              onClick={() => setTab("browse")}
            >
              {t.tools.mediaBin.tabs.browse}
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === "reorganise"}
              onClick={() => setTab("reorganise")}
            >
              {t.tools.mediaBin.tabs.reorganise}
            </button>
          </div>

          {tab === "diff" && diff && <DiffView diff={diff} />}

          {tab === "audit" && audit && inspected && (
            <>
              {left && right && (
                <div className="filters" style={{ marginTop: 0 }}>
                  <button
                    className="pill"
                    aria-pressed={auditSide === "left"}
                    onClick={() => setAuditSide("left")}
                  >
                    {left.filename} {t.tools.mediaBin.baselineSuffix}
                  </button>
                  <button
                    className="pill"
                    aria-pressed={auditSide === "right"}
                    onClick={() => setAuditSide("right")}
                  >
                    {right.filename}
                  </button>
                </div>
              )}
              <AuditView audit={audit} lib={inspected.library} />
            </>
          )}

          {tab === "browse" && inspected && <TreeView lib={inspected.library} />}

          {tab === "reorganise" && inspected && <ReorganiseView file={inspected} />}
        </>
      )}
    </>
  );
}

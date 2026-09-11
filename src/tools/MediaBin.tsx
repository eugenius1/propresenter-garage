// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useMemo, useState } from "react";
import { FileSlot } from "../components/FileSlot";
import { DiffView } from "../components/DiffView";
import { AuditView } from "../components/AuditView";
import { TreeView } from "../components/TreeView";
import { ReorganiseView } from "../components/ReorganiseView";
import { auditLibrary, type FindingId } from "../lib/audit";
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
/** Marks the panel as guidance rather than somewhere to drop a file. */
function InfoIcon() {
  return (
    <svg
      className="info-icon"
      viewBox="0 0 20 20"
      width="17"
      height="17"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="6.1" r="1.05" fill="currentColor" />
      <path
        d="M10 9v5.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MediaBin() {
  const { t, f } = useI18n();
  const [left, setLeft] = useState<LoadedFile | null>(null);
  const [right, setRight] = useState<LoadedFile | null>(null);
  const [tab, setTab] = useState<Tab>("audit");
  const [auditSide, setAuditSide] = useState<"left" | "right">("left");
  // Set when arriving at the Audit tab from a quick fix, so the finding that
  // fix came from is scrolled to rather than left to be hunted for.
  const [auditFocus, setAuditFocus] = useState<FindingId | null>(null);

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
        <div className="card info-card">
          <div className="empty-state">
            <p className="info-head">
              <InfoIcon />
              <strong>{t.tools.mediaBin.startHeading}</strong>
            </p>
            {t.tools.mediaBin.whereIntro}

            {/* The workspace moved in ProPresenter 20, so both locations are
                still in the wild -- one real library recorded paths under each. */}
            <dl className="where">
              <dt>{t.tools.mediaBin.whereWindows}</dt>
              <dd className="mono">
                %AppData%\RenewedVision\ProPresenter\LocalWorkspaces\…\Playlists\Media
              </dd>
              <dt>{t.tools.mediaBin.whereMac}</dt>
              <dd className="mono">
                ~/Library/Application Support/RenewedVision/ProPresenter/…/Playlists/Media
              </dd>
              <dt>{t.tools.mediaBin.whereLegacy}</dt>
              <dd className="mono">Documents/ProPresenter/Playlists/Media</dd>
            </dl>
            <p className="why">
              {f(t.tools.mediaBin.whereWorkspaceNote, { placeholder: "…" })}
            </p>

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
              onClick={() => { setAuditFocus(null); setTab("audit"); }}
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

          {tab === "diff" && diff && (
            <DiffView diff={diff} baseline={left ?? undefined} compare={right ?? undefined} />
          )}

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
              <AuditView audit={audit} lib={inspected.library} focus={auditFocus} />
            </>
          )}

          {tab === "browse" && inspected && <TreeView lib={inspected.library} />}

          {tab === "reorganise" && inspected && (
            <ReorganiseView
              file={inspected}
              onShowInAudit={(finding) => {
                setAuditFocus(finding);
                setTab("audit");
              }}
            />
          )}
        </>
      )}
    </>
  );
}

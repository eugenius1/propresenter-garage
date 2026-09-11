// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect, useMemo, useState } from "react";
import { FileSlot } from "./components/FileSlot";
import { DiffView } from "./components/DiffView";
import { AuditView } from "./components/AuditView";
import { TreeView } from "./components/TreeView";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { diffLibraries } from "./lib/diff";
import { auditLibrary } from "./lib/audit";
import { PROTO_VERSION } from "./lib/decode";
import type { LoadedFile } from "./lib/loadFile";
import { applyDocumentLanguage, useI18n } from "./i18n";

type Tab = "diff" | "audit" | "browse";

export default function App() {
  const { t, f, lang } = useI18n();
  const [left, setLeft] = useState<LoadedFile | null>(null);
  const [right, setRight] = useState<LoadedFile | null>(null);
  const [tab, setTab] = useState<Tab>("audit");
  const [auditSide, setAuditSide] = useState<"left" | "right">("left");

  useEffect(() => applyDocumentLanguage(lang), [lang]);

  const diff = useMemo(
    () => (left && right ? diffLibraries(left.library, right.library) : null),
    [left, right]
  );

  const inspected = auditSide === "right" && right ? right : left;
  const audit = useMemo(() => (inspected ? auditLibrary(inspected.library) : null), [inspected]);

  function loadLeft(file: LoadedFile) {
    setLeft(file);
    setTab(right ? "diff" : "audit");
  }
  function loadRight(file: LoadedFile) {
    setRight(file);
    if (left) setTab("diff");
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>{t.app.title}</h1>
        <p>{t.app.tagline}</p>
        <span className="spacer" />
        <span
          className="chip"
          title={f(t.app.schemaHelp, {
            files: PROTO_VERSION.files,
            commit: PROTO_VERSION.upstreamCommit?.slice(0, 7) ?? "?",
            date: new Date(PROTO_VERSION.builtAt).toLocaleDateString(undefined),
          })}
        >
          {f(t.app.schema, { version: PROTO_VERSION.version.split(",")[0] })}
        </span>
        <span className="chip ok" title={t.app.offlineHelp}>{t.app.offline}</span>
        <div className="pickers">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="slots">
        <FileSlot
          role={t.slots.baseline}
          hint={t.slots.baselineHint}
          file={left}
          onLoad={loadLeft}
          onClear={() => { setLeft(null); setTab("audit"); }}
        />
        <FileSlot
          role={t.slots.compare}
          hint={t.slots.compareHint}
          file={right}
          onLoad={loadRight}
          onClear={() => { setRight(null); setTab("audit"); }}
        />
      </div>

      {!left && !right ? (
        <div className="card">
          <div className="empty-state">
            <strong>{t.start.heading}</strong>
            {t.start.whereWindows}{" "}
            <span className="mono">Documents\ProPresenter\Media</span>,{" "}
            {t.start.whereMac}{" "}
            <span className="mono">~/Documents/ProPresenter/Media</span>. {t.start.noExtension}
            <p style={{ marginTop: 14 }}>{t.start.oneOrTwo}</p>
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
              title={diff ? undefined : t.tabs.diffDisabled}
            >
              {t.tabs.diff}{diff ? ` (${diff.changes.length})` : ""}
            </button>
            <button className="tab" role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")}>
              {t.tabs.audit}
            </button>
            <button className="tab" role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")}>
              {t.tabs.browse}
            </button>
          </div>

          {tab === "diff" && diff && <DiffView diff={diff} />}

          {tab === "audit" && audit && inspected && (
            <>
              {left && right && (
                <div className="filters" style={{ marginTop: 0 }}>
                  <button className="pill" aria-pressed={auditSide === "left"} onClick={() => setAuditSide("left")}>
                    {left.filename} {t.tabs.baselineSuffix}
                  </button>
                  <button className="pill" aria-pressed={auditSide === "right"} onClick={() => setAuditSide("right")}>
                    {right.filename}
                  </button>
                </div>
              )}
              <AuditView audit={audit} lib={inspected.library} />
            </>
          )}

          {tab === "browse" && inspected && <TreeView lib={inspected.library} />}
        </>
      )}

      <p className="footnote">
        {t.app.footnoteBefore}{" "}
        <a href="https://github.com/greyshirtguy/ProPresenter7-Proto" target="_blank" rel="noreferrer">
          {t.app.footnoteLink}
        </a>{" "}
        {t.app.footnoteAfter}
        {" · "}
        <a
          href="https://github.com/eugenius1/propresenter-garage/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer"
        >
          GPLv3
        </a>
      </p>
    </div>
  );
}

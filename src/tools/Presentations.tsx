// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useMemo, useRef, useState } from "react";
import {
  folderAccess,
  isPresentationFile,
  pickFolder,
  readFolderFromInput,
  type FolderFile,
} from "../lib/folder";
import { checkPresentationFile, type PresentationReport, type TextIssueKind } from "../lib/presentation";
import { useI18n } from "../i18n";

const KINDS: TextIssueKind[] = ["leadingSpace", "trailingSpace", "blankLine", "repeatedSpace"];

/**
 * Check the text of every presentation in a library.
 *
 * Reads a whole folder at once, because the problems it looks for are the kind
 * nobody finds by opening thirty songs one at a time: a space at the start of a
 * line that shifts it right, a space at the end that spoils centring, a
 * paragraph that shows nothing but still takes up room.
 */
export function Presentations() {
  const { t, f, num, plural } = useI18n();
  const p = t.tools.presentations;

  // What this browser can do with a folder does not change while it is open.
  const access = useMemo(() => folderAccess(), []);
  const input = useRef<HTMLInputElement>(null);

  const [reports, setReports] = useState<PresentationReport[] | null>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [fellBack, setFellBack] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<TextIssueKind>>(new Set(KINDS));

  async function scan(files: FolderFile[]) {
    const out: PresentationReport[] = [];
    for (const file of files) {
      setBusy(file.name);
      out.push(checkPresentationFile(file.path, await file.read()));
    }
    setBusy(null);
    setReports(out);
  }

  async function chooseFolder() {
    setError(null);
    setFellBack(false);
    try {
      const folder = await pickFolder(isPresentationFile, { write: false });
      if (!folder) return;
      setFolderName(folder.name);
      await scan(folder.files);
    } catch (e) {
      setBusy(null);
      // The picker can be unavailable for reasons the reader cannot act on --
      // an embedded frame, a policy, a browser that claims the API and then
      // refuses. Falling back to the directory input gets them a result
      // instead of an error, at the cost of not being able to write back.
      setFellBack(true);
      setError(null);
      input.current?.click();
      void e;
    }
  }

  const withIssues = useMemo(
    () => (reports ?? []).filter((r) => r.issues.some((i) => active.has(i.kind)) || r.error),
    [reports, active]
  );

  const totalIssues = useMemo(
    () => (reports ?? []).reduce((n, r) => n + r.issues.filter((i) => active.has(i.kind)).length, 0),
    [reports, active]
  );

  const countOf = (kind: TextIssueKind) =>
    (reports ?? []).reduce((n, r) => n + r.issues.filter((i) => i.kind === kind).length, 0);

  const toggle = (kind: TextIssueKind) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next.size === 0 ? new Set(KINDS) : next;
    });

  return (
    <>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="sub">{p.chooseHint}</p>

        <div className="editor-bar">
          {/* One button, whichever route this browser supports. Offering both
              the picker and the input produced two controls with the same
              label and no way to tell them apart. */}
          <button
            className="btn primary"
            onClick={() => (access === "readwrite" ? void chooseFolder() : input.current?.click())}
            disabled={busy !== null}
          >
            {access === "unavailable" ? p.pickFiles : p.pickFolder}
          </button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            // Reading a folder this way works in every browser, including the
            // ones with no directory picker -- it just cannot write back.
            {...(access === "unavailable" ? {} : { webkitdirectory: "" })}
            onChange={(e) => {
              const list = e.target.files;
              if (!list) return;
              setError(null);
              const folder = readFolderFromInput(list, isPresentationFile);
              setFolderName(folder.name);
              void scan(folder.files);
            }}
          />
          {busy && <span className="editor-count">{f(p.scanning, { n: busy })}</span>}
        </div>

        <p className="why">
          {access === "readwrite"
            ? p.readwriteNote
            : access === "readonly"
              ? p.readonlyNote
              : p.unavailableNote}{" "}
          {access === "readwrite" && p.installNote}
        </p>

        {fellBack && <p className="why warn-inline">{p.pickerFailed}</p>}
        {error && <p className="why warn-inline">{error}</p>}

        {reports && (
          <>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="n">{num(reports.length)}</div>
                <div className="l">{p.name}</div>
              </div>
              {KINDS.map((kind) => (
                <div className="stat" key={kind}>
                  <div className="n">{num(countOf(kind))}</div>
                  <div className="l">{p.kinds[kind]}</div>
                </div>
              ))}
            </div>

            {reports.length === 0 && (
              <p className="sub warn-inline">
                {f(p.noneFound, { folder: folderName || "—" })}
              </p>
            )}
            {reports.length > 0 && folderName && (
              <p className="why">{f(p.scanned, { folder: folderName })}</p>
            )}
          </>
        )}
      </div>

      {reports && reports.length > 0 && (
        <div className="card">
          <h2>
            {totalIssues === 0
              ? p.clean
              : plural(p.issuesFound, totalIssues, {
                  files: plural(p.inFiles, withIssues.length),
                })}
          </h2>
          <p className="sub">{p.emptyBoxesNote}</p>

          <div className="filters">
            {KINDS.map((kind) => (
              <button
                key={kind}
                className="pill"
                aria-pressed={active.has(kind)}
                disabled={countOf(kind) === 0}
                title={p.why[kind]}
                onClick={() => toggle(kind)}
              >
                {p.kinds[kind]} {num(countOf(kind))}
              </button>
            ))}
          </div>

          {withIssues.map((report) => (
            <div className="finding" key={report.filename}>
              <h3>
                {report.name || report.filename}
                <span className="count-badge">
                  {report.error
                    ? "!"
                    : num(report.issues.filter((i) => active.has(i.kind)).length)}
                </span>
              </h3>
              <p className="why">
                {report.error
                  ? f(p.unreadable, { reason: report.error })
                  : f(p.slidesAndBoxes, {
                      slides: num(report.slideCount),
                      empty: num(report.emptyTextBoxes),
                    })}
              </p>

              {!report.error && (
                <ul className="rows">
                  {report.issues
                    .filter((i) => active.has(i.kind))
                    .map((issue, index) => (
                      <li key={index}>
                        <div>
                          <span className={`tag ${issue.kind}`}>{p.kinds[issue.kind]}</span>{" "}
                          <span className="node-count">
                            {f(p.slide, { n: num(issue.slideIndex + 1) })}
                            {issue.groupName ? ` · ${issue.groupName}` : ""} ·{" "}
                            {f(p.line, { n: num(issue.lineIndex + 1) })}
                          </span>
                        </div>
                        {/* Rendered with the whitespace made visible, since the
                            whole point is characters you cannot otherwise see. */}
                        <div className="path whitespace">
                          {issue.text === "" ? "—" : visibleWhitespace(issue.text)}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Show leading and trailing spaces as middle dots, so they can be seen. */
function visibleWhitespace(text: string): string {
  const leading = text.length - text.trimStart().length;
  const trailing = text.length - text.trimEnd().length;
  return (
    "·".repeat(leading) +
    text.slice(leading, text.length - trailing).replace(/ {2,}/g, (run) => "·".repeat(run.length)) +
    "·".repeat(trailing)
  );
}

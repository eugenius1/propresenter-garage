// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useMemo, useState } from "react";
import { planMerges, type MergeDirection } from "../lib/merge";
import { exportFilename, exportOperations, OperationError } from "../lib/operations";
import type { LoadedFile } from "../lib/loadFile";
import type { Change, ChangeDetail, ChangeType, DiffResult, PlaylistChange } from "../lib/diff";
import { useI18n, type I18n } from "../i18n";
import { describeModsInline, playbackLabel, playbackValue } from "../i18n/describe";

const ORDER: ChangeType[] = [
  "added", "removed", "moved", "renamed", "relinked", "restyled", "retimed",
];

/**
 * Change types whose detail line does not already name the playlist. For
 * added, removed and moved the location is part of the detail, so repeating it
 * underneath just says the same thing twice.
 */
const SHOWS_LOCATION = new Set<ChangeType>(["renamed", "retimed", "restyled", "relinked"]);

/** Render a change's structured detail as a sentence in the active language. */
function detailText(i18n: I18n, change: Change): string {
  const { t, f } = i18n;
  const detail: ChangeDetail = change.detail;
  const arrow = (from: string, to: string) => `${from || t.diff.root} → ${to || t.diff.root}`;

  switch (detail.kind) {
    case "presence": {
      const where = f(change.type === "added" ? t.diff.nowIn : t.diff.wasIn, {
        playlist: detail.playlist || t.diff.root,
      });
      const settings = detail.playback
        .map((p) => `${playbackLabel(i18n, p.key)} ${playbackValue(i18n, p.key, p.value)}`)
        .join(", ");
      return settings ? `${where} (${settings})` : where;
    }
    case "move":
      return arrow(detail.from, detail.to);
    case "rename":
      return arrow(i18n.quote(detail.from), i18n.quote(detail.to));
    case "relink":
      return arrow(detail.from, detail.to);
    case "playback":
      return detail.deltas
        .map(
          (d) =>
            `${playbackLabel(i18n, d.key)}${t.meta.colon}` +
            `${playbackValue(i18n, d.key, d.from)} → ${playbackValue(i18n, d.key, d.to)}`
        )
        .join(", ");
    case "mods":
      return arrow(describeModsInline(i18n, detail.from), describeModsInline(i18n, detail.to));
  }
}

function playlistChangeText({ t }: I18n, change: PlaylistChange): string {
  if (change.type === "renamed") return `${change.from} → ${change.path}`;
  return `${change.path} — ${t.diff.playlistTypes[change.type]}`;
}

export function DiffView({
  diff,
  baseline,
  compare,
}: {
  diff: DiffResult;
  /** The loaded files behind the diff, needed to edit and export either side. */
  baseline?: LoadedFile;
  compare?: LoadedFile;
}) {
  const i18n = useI18n();
  const { t, f, plural, num } = i18n;
  const [active, setActive] = useState<Set<ChangeType>>(new Set(ORDER));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [direction, setDirection] = useState<MergeDirection>("intoBaseline");
  const [exported, setExported] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const canMerge = Boolean(baseline && compare);
  const target = direction === "intoBaseline" ? baseline : compare;

  // Indices into diff.changes, so a selection survives filtering the list.
  const toggleSelected = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const chosen = useMemo(
    () => [...selected].sort((a, b) => a - b).map((i) => diff.changes[i]).filter(Boolean),
    [selected, diff]
  );

  const plan = useMemo(() => {
    if (!baseline || !compare || chosen.length === 0) return null;
    return planMerges(chosen, direction, baseline.doc, compare.doc);
  }, [chosen, direction, baseline, compare]);

  function applyAndExport() {
    if (!plan || !target) return;
    setFailure(null);
    try {
      const bytes = exportOperations(target.doc, plan.operations);
      const name = exportFilename(target.filename);
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], { type: "application/octet-stream" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExported(name);
    } catch (e) {
      // Two chosen changes can contradict each other -- adopting an entry and
      // removing it, say. Report it rather than writing half a file.
      setFailure(e instanceof OperationError ? e.message : (e as Error).message);
    }
  }

  const visible = useMemo(() => diff.changes.filter((c) => active.has(c.type)), [diff, active]);

  const toggle = (type: ChangeType) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next.size === 0 ? new Set(ORDER) : next;
    });

  const total = diff.changes.length;

  return (
    <>
      <div className="card">
        <h2>{t.diff.summary}</h2>
        <p className="sub">
          {total === 0
            ? t.diff.identical
            : plural(t.diff.changeCount, total, {
                from: num(diff.left.items.length),
                to: num(diff.right.items.length),
              })}
        </p>
        <div className="stats">
          {ORDER.map((type) => (
            <div className="stat" key={type}>
              <div className="n" style={{ color: `var(--${type})` }}>{num(diff.counts[type])}</div>
              <div className="l">{t.diff.types[type]}</div>
            </div>
          ))}
        </div>

        {diff.playlistChanges.length > 0 && (
          <div className="finding" style={{ marginTop: 14 }}>
            <h3>
              {t.diff.playlistStructure}
              <span className="count-badge">{num(diff.playlistChanges.length)}</span>
            </h3>
            <ul className="rows">
              {diff.playlistChanges.map((change, i) => (
                <li key={i}>
                  <span className={`tag ${change.type}`} style={{ marginRight: 8 }}>
                    {t.diff.types[change.type]}
                  </span>
                  <span className="path">{playlistChangeText(i18n, change)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {canMerge && total > 0 && (
        <div className="card">
          <h2>{t.tools.mediaBin.merge.heading}</h2>
          <p className="sub">{t.tools.mediaBin.merge.intro}</p>

          <div className="editor-bar">
            <label className="merge-direction">
              {t.tools.mediaBin.merge.direction}{" "}
              <select
                className="picker-select"
                value={direction}
                onChange={(e) => setDirection(e.target.value as MergeDirection)}
              >
                <option value="intoBaseline">
                  {f(t.tools.mediaBin.merge.intoBaseline, { filename: baseline!.filename })}
                </option>
                <option value="intoCompare">
                  {f(t.tools.mediaBin.merge.intoCompare, { filename: compare!.filename })}
                </option>
              </select>
            </label>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => setSelected(new Set(diff.changes.map((_, i) => i)))}
            >
              {t.tools.mediaBin.merge.selectAll}
            </button>
            <button className="btn" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
              {t.tools.mediaBin.merge.selectNone}
            </button>
            <button
              className="btn primary"
              disabled={!plan || plan.operations.length === 0 || !target?.exportSafe}
              title={target?.exportSafe ? undefined : t.tools.mediaBin.merge.exportBlocked}
              onClick={applyAndExport}
            >
              {t.tools.mediaBin.merge.applyAndExport}
            </button>
          </div>

          <p className="sub" style={{ marginBottom: 0 }}>
            {selected.size === 0
              ? t.tools.mediaBin.merge.nothingSelected
              : plural(t.tools.mediaBin.merge.selected, selected.size)}
          </p>

          {plan && plan.blocked.length > 0 && (
            <p className="why warn-inline">
              {plural(t.tools.mediaBin.merge.blocked, plan.blocked.length)} —{" "}
              {t.tools.mediaBin.merge.blockedWhy}
            </p>
          )}
          {target && !target.exportSafe && (
            <p className="why warn-inline">{t.tools.mediaBin.merge.exportBlocked}</p>
          )}
          {failure && (
            <p className="why warn-inline">
              {f(t.tools.mediaBin.merge.failed, { reason: failure })}
            </p>
          )}
          {exported && (
            <p className="why">{f(t.tools.mediaBin.merge.exportedAs, { filename: exported })}</p>
          )}
        </div>
      )}

      {total > 0 && (
        <div className="card">
          <h2>{t.diff.changes}</h2>
          <p className="sub">{t.diff.method}</p>

          <div className="filters">
            {ORDER.map((type) => (
              <button
                key={type}
                className="pill"
                aria-pressed={active.has(type)}
                disabled={diff.counts[type] === 0}
                onClick={() => toggle(type)}
                title={t.diff.explain[type]}
              >
                {t.diff.types[type]} {num(diff.counts[type])}
              </button>
            ))}
          </div>

          <ul className="changes">
            {visible.map((change) => {
              const index = diff.changes.indexOf(change);
              return (
              <li className={`change${canMerge ? " selectable" : ""}`} key={index}>
                {canMerge && (
                  <input
                    type="checkbox"
                    className="change-select"
                    checked={selected.has(index)}
                    onChange={() => toggleSelected(index)}
                    aria-label={`${t.diff.types[change.type]}: ${change.item.name || change.item.displayFilename}`}
                  />
                )}
                <span className={`tag ${change.type}`}>{t.diff.types[change.type]}</span>
                <div className="change-body">
                  <div className="change-title">
                    {change.item.name || change.item.displayFilename}
                    <span className="kind">{t.kinds[change.item.kind]}</span>
                    {change.fuzzy && (
                      <span className="fuzzy" title={t.diff.pathMatchHelp}>{t.diff.pathMatch}</span>
                    )}
                  </div>
                  <div className="change-detail">{detailText(i18n, change)}</div>
                  {SHOWS_LOCATION.has(change.type) && change.item.playlistPath && (
                    <div className="change-where">
                      {f(t.diff.inPlaylist, { playlist: change.item.playlistPath })}
                    </div>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

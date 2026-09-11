// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import type { ReactNode } from "react";
import { FINDING_DOM_ID, type AuditResult, type FindingId } from "../lib/audit";
import type { MediaLibrary } from "../lib/model";
import { useEffect } from "react";
import { useI18n, type I18n } from "../i18n";
import { describeModsInline } from "../i18n/describe";

function Rows({
  children,
  limit = 12,
  i18n,
}: {
  children: ReactNode[];
  limit?: number;
  i18n: I18n;
}) {
  const head = children.slice(0, limit);
  const rest = children.slice(limit);
  return (
    <>
      <ul className="rows">{head}</ul>
      {rest.length > 0 && (
        <details className="more">
          <summary>{i18n.plural(i18n.t.audit.more, rest.length)}</summary>
          <ul className="rows">{rest}</ul>
        </details>
      )}
    </>
  );
}

export function AuditView({
  audit,
  lib,
  focus,
}: {
  audit: AuditResult;
  lib: MediaLibrary;
  /** A finding to scroll to and highlight, set when arriving from elsewhere. */
  focus?: FindingId | null;
}) {
  const i18n = useI18n();

  useEffect(() => {
    if (!focus) return;
    const target = document.getElementById(FINDING_DOM_ID(focus));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // A brief highlight, because scrolling alone leaves the reader hunting for
    // which of several findings they were sent to.
    target.classList.add("flash");
    const timer = setTimeout(() => target.classList.remove("flash"), 1600);
    return () => clearTimeout(timer);
  }, [focus, audit]);
  const { t, f, num, quote, plural } = i18n;
  const totals = audit.totals;

  const quoteAll = (labels: string[]) => labels.map(quote).join(", ");

  const nothingFlagged =
    audit.withinPlaylistDuplicates.length === 0 &&
    audit.crossPlaylistDuplicates.length === 0 &&
    audit.emptyPlaylists.length === 0 &&
    audit.externalVolumeItems.length === 0 &&
    audit.absolutePathRoots.length <= 1;

  return (
    <>
      <div className="card">
        <h2>{t.library.heading}</h2>
        <p className="sub">
          {f(t.library.appOn, { version: lib.appVersion, platform: lib.platform })}
        </p>
        <div className="stats">
          <div className="stat"><div className="n">{num(totals.items)}</div><div className="l">{t.library.items}</div></div>
          <div className="stat"><div className="n">{num(totals.playlists)}</div><div className="l">{t.library.playlists}</div></div>
          <div className="stat"><div className="n">{num(totals.video)}</div><div className="l">{t.library.video}</div></div>
          <div className="stat"><div className="n">{num(totals.image)}</div><div className="l">{t.library.image}</div></div>
          {totals.audio > 0 && (
            <div className="stat"><div className="n">{num(totals.audio)}</div><div className="l">{t.library.audio}</div></div>
          )}
          {totals.other > 0 && (
            <div className="stat"><div className="n">{num(totals.other)}</div><div className="l">{t.library.other}</div></div>
          )}
          <div className="stat"><div className="n">{num(totals.modified)}</div><div className="l">{t.library.modified}</div></div>
        </div>
      </div>

      <div className="card">
        <h2>{t.audit.heading}</h2>
        <p className="sub">{t.audit.method}</p>

        {audit.withinPlaylistDuplicates.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("withinPlaylist")}>
            <h3>
              {t.audit.withinPlaylist}
              <span className="count-badge warn">{num(audit.withinPlaylistDuplicates.length)}</span>
            </h3>
            <p className="why">{t.audit.withinPlaylistWhy}</p>
            <Rows i18n={i18n}>
              {audit.withinPlaylistDuplicates.map((group, i) => (
                <li key={i}>
                  <div>
                    <strong>{num(group.items.length)}×</strong> {group.filename}
                    {group.labels.length > 1 && (
                      <span className="node-count">
                        {" — "}
                        {f(t.audit.labelled, { labels: quoteAll(group.labels) })}
                      </span>
                    )}
                  </div>
                  <div className="path">{group.items[0].relativePath}</div>
                  <div className="path">{group.repeatedWithin.join("  ·  ")}</div>
                  {group.items[0].modifications.descriptors.length > 0 && (
                    <div className="path">
                      {f(t.audit.allWith, {
                        mods: describeModsInline(i18n, group.items[0].modifications.descriptors),
                      })}
                    </div>
                  )}
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.crossPlaylistDuplicates.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("crossPlaylist")}>
            <h3>
              {t.audit.crossPlaylist}
              <span className="count-badge">{num(audit.crossPlaylistDuplicates.length)}</span>
            </h3>
            <p className="why">{t.audit.crossPlaylistWhy}</p>
            <Rows limit={10} i18n={i18n}>
              {audit.crossPlaylistDuplicates.map((group, i) => (
                <li key={i}>
                  <div>
                    {group.filename}
                    {group.labels.length > 1 && (
                      <span className="warn-inline"> — {group.labels.map(quote).join("  vs  ")}</span>
                    )}
                  </div>
                  <div className="path">{group.items[0].relativePath}</div>
                  {/* A file with variants yields one group per variant, so the
                      filename alone would not say which one this is. */}
                  {group.items[0].modifications.descriptors.length > 0 && (
                    <div className="path">
                      {describeModsInline(i18n, group.items[0].modifications.descriptors)}
                    </div>
                  )}
                  <div className="path">{group.playlists.join("  ·  ")}</div>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.variantGroups.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("variants")}>
            <h3>
              {t.audit.variants}
              <span className="count-badge">{num(audit.variantGroups.length)}</span>
            </h3>
            <p className="why">{t.audit.variantsWhy}</p>
            <Rows limit={8} i18n={i18n}>
              {audit.variantGroups.map((group, i) => (
                <li key={i}>
                  <div className="mono">{group.path}</div>
                  <ul className="rows" style={{ paddingLeft: 14, marginTop: 3 }}>
                    {group.variants.map((variant, j) => (
                      <li key={j} style={{ borderTop: "none", padding: "3px 0" }}>
                        <div>
                          <span>{quoteAll(variant.labels) || t.audit.unnamed}</span>
                          {variant.count > 1 && <span className="node-count"> ×{num(variant.count)}</span>}
                          <span className="node-count">
                            {" — "}
                            {describeModsInline(i18n, variant.modifications)}
                          </span>
                        </div>
                        <div className="path">{variant.playlists.join("  ·  ")}</div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.absolutePathRoots.length > 1 && (
          <div className="finding" id={FINDING_DOM_ID("locations")}>
            <h3>
              {t.audit.locations}
              <span className="count-badge">{num(audit.absolutePathRoots.length)}</span>
            </h3>
            <p className="why">{t.audit.locationsWhy}</p>
            <Rows limit={6} i18n={i18n}>
              {audit.absolutePathRoots.map((row, i) => (
                <li key={i}>
                  <span className="mono">{row.root}</span>
                  <span className="node-count"> — {plural(t.audit.locationCount, row.count)}</span>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.externalVolumeItems.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("external")}>
            <h3>
              {t.audit.external}
              <span className="count-badge warn">{num(audit.externalVolumeItems.length)}</span>
            </h3>
            <p className="why">{t.audit.externalWhy}</p>
            <Rows i18n={i18n}>
              {audit.externalVolumeItems.map((item) => (
                <li key={item.uuid}>
                  <div>{item.name || item.displayFilename}</div>
                  <div className="path">{item.root} · {item.relativePath}</div>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.emptyPlaylists.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("empty")}>
            <h3>
              {t.audit.empty}
              <span className="count-badge">{num(audit.emptyPlaylists.length)}</span>
            </h3>
            <p className="why">{t.audit.emptyWhy}</p>
            <Rows i18n={i18n}>
              {audit.emptyPlaylists.map((path, i) => (
                <li key={i}><span className="path">{path}</span></li>
              ))}
            </Rows>
          </div>
        )}

        {audit.hiddenItems.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("hidden")}>
            <h3>
              {t.audit.hidden}
              <span className="count-badge">{num(audit.hiddenItems.length)}</span>
            </h3>
            <p className="why">{t.audit.hiddenWhy}</p>
            <Rows i18n={i18n}>
              {audit.hiddenItems.map((item) => (
                <li key={item.uuid}>
                  <div>{item.name || item.displayFilename}</div>
                  <div className="path">{item.playlistPath}</div>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {audit.nameMismatches.length > 0 && (
          <div className="finding" id={FINDING_DOM_ID("nameMismatch")}>
            <h3>
              {t.audit.nameMismatch}
              <span className="count-badge">{num(audit.nameMismatches.length)}</span>
            </h3>
            <p className="why">{t.audit.nameMismatchWhy}</p>
            <Rows limit={8} i18n={i18n}>
              {audit.nameMismatches.map((row, i) => (
                <li key={i}>
                  <div>{quote(row.item.name)}</div>
                  <div className="path">→ {row.item.relativePath}</div>
                </li>
              ))}
            </Rows>
          </div>
        )}

        {nothingFlagged && <p className="sub">{t.audit.nothing}</p>}
      </div>
    </>
  );
}

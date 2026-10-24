import type { ReactNode } from "react";
import { FINDING_DOM_ID, type AuditResult, type FindingId } from "@propresenter-garage/core/lib/audit";
import { itemLabel, type MediaLibrary } from "@propresenter-garage/core/lib/model";
import { useEffect } from "react";
import { useI18n, type I18n } from "../i18n";
import { describeModsInline } from "@propresenter-garage/core/i18n/describe";

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

/** One finding: its heading and count, why it matters, and the rows. Nothing when there are none. */
function Finding({
  id,
  title,
  why,
  count,
  warn = false,
  limit,
  children,
}: {
  id: FindingId;
  title: string;
  why: string;
  count: number;
  warn?: boolean;
  limit?: number;
  children: ReactNode[];
}) {
  const i18n = useI18n();
  if (count === 0) return null;
  return (
    <div className="finding" id={FINDING_DOM_ID(id)}>
      <h3>
        {title}
        <span className={warn ? "count-badge warn" : "count-badge"}>{i18n.num(count)}</span>
      </h3>
      <p className="why">{why}</p>
      <Rows limit={limit} i18n={i18n}>
        {children}
      </Rows>
    </div>
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
    audit.hiddenItems.length === 0 &&
    audit.nameMismatches.length === 0 &&
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

        <Finding
          id="withinPlaylist"
          title={t.audit.withinPlaylist}
          why={t.audit.withinPlaylistWhy}
          count={audit.withinPlaylistDuplicates.length}
          warn
        >
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
        </Finding>

        <Finding
          id="crossPlaylist"
          title={t.audit.crossPlaylist}
          why={t.audit.crossPlaylistWhy}
          count={audit.crossPlaylistDuplicates.length}
          limit={10}
        >
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
        </Finding>

        <Finding
          id="variants"
          title={t.audit.variants}
          why={t.audit.variantsWhy}
          count={audit.variantGroups.length}
          limit={8}
        >
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
        </Finding>

        {audit.absolutePathRoots.length > 1 && (
          <Finding
            id="locations"
            title={t.audit.locations}
            why={t.audit.locationsWhy}
            count={audit.absolutePathRoots.length}
            limit={6}
          >
            {audit.absolutePathRoots.map((row, i) => (
              <li key={i}>
                <span className="mono">{row.root}</span>
                <span className="node-count"> — {plural(t.audit.locationCount, row.count)}</span>
              </li>
            ))}
          </Finding>
        )}

        <Finding
          id="external"
          title={t.audit.external}
          why={t.audit.externalWhy}
          count={audit.externalVolumeItems.length}
          warn
        >
          {audit.externalVolumeItems.map((item) => (
            <li key={item.uuid}>
              <div>{itemLabel(item)}</div>
              <div className="path">{item.root} · {item.relativePath}</div>
            </li>
          ))}
        </Finding>

        <Finding
          id="empty"
          title={t.audit.empty}
          why={t.audit.emptyWhy}
          count={audit.emptyPlaylists.length}
        >
          {audit.emptyPlaylists.map((path, i) => (
            <li key={i}><span className="path">{path}</span></li>
          ))}
        </Finding>

        <Finding
          id="hidden"
          title={t.audit.hidden}
          why={t.audit.hiddenWhy}
          count={audit.hiddenItems.length}
        >
          {audit.hiddenItems.map((item) => (
            <li key={item.uuid}>
              <div>{itemLabel(item)}</div>
              <div className="path">{item.playlistPath}</div>
            </li>
          ))}
        </Finding>

        <Finding
          id="nameMismatch"
          title={t.audit.nameMismatch}
          why={t.audit.nameMismatchWhy}
          count={audit.nameMismatches.length}
          limit={8}
        >
          {audit.nameMismatches.map((row, i) => (
            <li key={i}>
              <div>{quote(row.item.name)}</div>
              <div className="path">→ {row.item.relativePath}</div>
            </li>
          ))}
        </Finding>

        {nothingFlagged && <p className="sub">{t.audit.nothing}</p>}
      </div>
    </>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { MediaBin } from "./tools/MediaBin";
import { Presentations } from "./tools/Presentations";
import { PROTO_VERSION } from "./lib/decode";
import { applyDocumentLanguage, useI18n } from "./i18n";
import { basePath, pathForSlug, slugFromPath } from "./lib/routing";

type ToolId = "presentations" | "mediaBin";

/** URL segment per tool. The first is the home page and owns the root path. */
const SLUGS: Record<ToolId, string> = {
  presentations: "presentations",
  mediaBin: "media-bin",
};
const SLUG_LIST = Object.values(SLUGS);
const TOOL_BY_SLUG = Object.fromEntries(
  Object.entries(SLUGS).map(([id, slug]) => [slug, id as ToolId])
) as Record<string, ToolId>;

/**
 * The shell: title, appearance and language controls, licence notice, and the
 * active tool.
 *
 * Tool selection is a plain list rather than a registry with extension points.
 * Two tools share nothing but the chrome around them -- one reads a playlist
 * document, the other a folder of presentations -- so there is nothing yet for
 * an abstraction to hold. Routing is still absent because nothing has asked to
 * be linkable.
 */
/**
 * The copyright span, widening to a range as the project outlives its first
 * year rather than silently claiming only the current one.
 */
const FIRST_PUBLISHED = 2026;

function copyrightYears(now = new Date()): string {
  const current = now.getFullYear();
  return current > FIRST_PUBLISHED ? `${FIRST_PUBLISHED}\u2013${current}` : String(FIRST_PUBLISHED);
}

export default function App() {
  const { t, f, lang } = useI18n();
  // Read once: where the app is mounted cannot change while it is running.
  const base = useMemo(() => basePath(window.location.pathname, SLUG_LIST), []);

  const [tool, setTool] = useState<ToolId>(() => {
    const slug = slugFromPath(window.location.pathname, SLUG_LIST);
    return slug ? TOOL_BY_SLUG[slug] : "presentations";
  });

  useEffect(() => applyDocumentLanguage(lang), [lang]);

  // Back and forward should move between tools, so the browser's own history
  // works rather than trapping the reader on whichever one they opened.
  useEffect(() => {
    const onPop = () => {
      const slug = slugFromPath(window.location.pathname, SLUG_LIST);
      setTool(slug ? TOOL_BY_SLUG[slug] : "presentations");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function show(id: ToolId) {
    setTool(id);
    const next = pathForSlug(base, SLUGS[id], SLUG_LIST);
    if (next !== window.location.pathname) {
      window.history.pushState(null, "", next + window.location.search);
    }
  }

  const tools: { id: ToolId; name: string; tagline: string }[] = [
    { id: "presentations", name: t.tools.presentations.name, tagline: t.tools.presentations.tagline },
    { id: "mediaBin", name: t.tools.mediaBin.name, tagline: t.tools.mediaBin.tagline },
  ];
  const current = tools.find((entry) => entry.id === tool)!;

  return (
    <div className="app">
      <header className="masthead">
        <span className="brand">
          <Logo />
          <h1>{t.app.title}</h1>
        </span>
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
        <span className="chip ok" title={t.app.offlineHelp}>
          {t.app.offline}
        </span>
        <div className="pickers">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </header>

      <nav className="tools" aria-label={t.app.toolLabel}>
        {tools.map((entry) => (
          <button
            key={entry.id}
            className="tool-tab"
            aria-current={entry.id === tool ? "page" : undefined}
            onClick={() => show(entry.id)}
          >
            {entry.name}
          </button>
        ))}
      </nav>

      <p className="tool-tagline">{current.tagline}</p>

      {tool === "presentations" ? <Presentations /> : <MediaBin />}

      <p className="footnote">
        <span className="copyright">
          {f(t.app.copyright, { years: copyrightYears() })} ·{" "}
          <a
            href="https://github.com/eugenius1/propresenter-garage/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            GPLv3
          </a>
        </span>
        {t.app.footnoteBefore}{" "}
        <a
          href="https://github.com/greyshirtguy/ProPresenter7-Proto"
          target="_blank"
          rel="noreferrer"
        >
          {t.app.footnoteLink}
        </a>{" "}
        {t.app.footnoteAfter}
      </p>

      <UpdatePrompt />
    </div>
  );
}

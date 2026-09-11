// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect } from "react";
import { Logo } from "./components/Logo";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { MediaBin } from "./tools/MediaBin";
import { PROTO_VERSION } from "./lib/decode";
import { applyDocumentLanguage, useI18n } from "./i18n";

/**
 * The shell: title, appearance and language controls, licence notice, and the
 * active tool.
 *
 * There is one tool, so it is rendered directly. Tool selection, routing and a
 * registry are deliberately absent -- those are answers to questions the second
 * tool has not asked yet, and guessing them now would mean building extension
 * points it may not want.
 */
export default function App() {
  const { t, f, lang } = useI18n();

  useEffect(() => applyDocumentLanguage(lang), [lang]);

  return (
    <div className="app">
      <header className="masthead">
        <span className="brand">
          <Logo />
          <h1>{t.app.title}</h1>
        </span>
        <p>{t.tools.mediaBin.tagline}</p>
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

      <MediaBin />

      <p className="footnote">
        {t.app.footnoteBefore}{" "}
        <a
          href="https://github.com/greyshirtguy/ProPresenter7-Proto"
          target="_blank"
          rel="noreferrer"
        >
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

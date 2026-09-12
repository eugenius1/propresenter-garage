// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { ChevronDown, Globe } from "lucide-react";
import { DICTIONARIES, LANGUAGES, useI18n, type Lang } from "../i18n";

/**
 * Explicit language override, sitting top right.
 *
 * The default comes from the device, so this exists for the cases the device
 * cannot express: a French operator on an English-configured booth machine, or
 * anyone who simply prefers the other one. The choice is remembered.
 *
 * Built on a native `<select>` rather than a custom menu: it gets keyboard
 * handling, screen-reader semantics and the platform's own picker on mobile for
 * free, and it stays usable as more languages are added.
 */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="picker">
      <Globe className="picker-icon" size={13} aria-hidden />
      <select
        className="picker-select"
        aria-label={t.app.languageLabel}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
      >
        {LANGUAGES.map((code) => (
          <option key={code} value={code} lang={DICTIONARIES[code].meta.localeTag}>
            {DICTIONARIES[code].meta.name}
          </option>
        ))}
      </select>
      <ChevronDown className="picker-caret" size={13} aria-hidden />
    </div>
  );
}

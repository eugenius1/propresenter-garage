// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

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
      <GlobeIcon />
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
      <CaretIcon />
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      className="picker-icon"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {/* Equator and central meridian, plus the two curves that read as a globe. */}
      <path
        d="M1.6 8h12.8M8 1.6c3.4 3.5 3.4 9.3 0 12.8M8 1.6C4.6 5.1 4.6 10.9 8 14.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg
      className="picker-caret"
      viewBox="0 0 10 6"
      width="8"
      height="5"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1 1l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

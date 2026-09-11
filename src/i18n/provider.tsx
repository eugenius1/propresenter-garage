// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createI18n, detectLanguage, type I18n, type Lang } from "./core";

/**
 * React binding for the translation core.
 *
 * Separate from the barrel so this file exports only the provider and its hook
 * -- which is what keeps fast refresh granular during development.
 */
const STORAGE_KEY = "propresenter-garage.lang";

function isLang(value: unknown): value is Lang {
  return value === "en" || value === "fr";
}

/** A language the reader chose explicitly, which outranks the device default. */
function storedLanguage(): Lang | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    // Private windows and blocked site data throw on access.
    return null;
  }
}

function persistLanguage(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => storedLanguage() ?? detectLanguage());

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLanguage(next);
  }, []);

  const value = useMemo(() => createI18n(lang, setLang), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Access the active translator.
 *
 * Deliberately exported from the same file as the provider: splitting them
 * would mean exporting the context object itself, which is worse layering than
 * the slightly coarser fast refresh this costs. `only-export-components` is
 * switched off for this path in .oxlintrc.json for that reason.
 */
export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

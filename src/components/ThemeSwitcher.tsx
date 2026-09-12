// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect, useState } from "react";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n";
import {
  applyTheme,
  storedTheme,
  persistTheme,
  THEMES,
  watchSystemTheme,
  type Theme,
} from "../theme";

/**
 * Light/dark override, alongside the language selector.
 *
 * Defaults to `system`, and keeps following the system while it stays there --
 * so a booth machine that switches to dark in the evening takes the app with
 * it. Built on a native `<select>` for the same reasons as the language
 * control: real keyboard handling, screen-reader semantics, and the platform's
 * own picker on mobile.
 */
export function ThemeSwitcher() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? "system");

  useEffect(() => {
    applyTheme(theme);
    // Only worth listening while we are actually deferring to the system.
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    persistTheme(next);
  }

  return (
    <div className="picker">
      {/* A monitor for "follow the system", which is what it follows. */}
      {theme === "light" ? (
        <Sun className="picker-icon" size={13} aria-hidden />
      ) : theme === "dark" ? (
        <Moon className="picker-icon" size={13} aria-hidden />
      ) : (
        <Monitor className="picker-icon" size={13} aria-hidden />
      )}
      <select
        className="picker-select"
        aria-label={t.app.themeLabel}
        value={theme}
        onChange={(e) => choose(e.target.value as Theme)}
      >
        {THEMES.map((option) => (
          <option key={option} value={option}>
            {t.themes[option]}
          </option>
        ))}
      </select>
      <ChevronDown className="picker-caret" size={13} aria-hidden />
    </div>
  );
}

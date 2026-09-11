import { useEffect, useState } from "react";
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
      <ThemeIcon theme={theme} />
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
      <CaretIcon />
    </div>
  );
}

/** Half-filled circle for system, sun for light, moon for dark. */
function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    viewBox: "0 0 16 16",
    width: 13,
    height: 13,
    "aria-hidden": true,
    focusable: "false" as const,
    className: "picker-icon",
  };

  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.2" fill="currentColor" />
        <path
          d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg {...common}>
        <path
          d="M13.2 10.1A5.8 5.8 0 015.9 2.8 6.2 6.2 0 1013.2 10.1z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {/* Left half filled: the theme is whatever the device says. */}
      <path d="M8 1.8a6.2 6.2 0 000 12.4z" fill="currentColor" />
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

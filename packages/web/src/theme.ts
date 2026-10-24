/**
 * Light/dark handling.
 *
 * Three states, not two: `system` follows the device and is the default, while
 * `light` and `dark` are explicit overrides. The distinction matters because
 * following the system has to keep working when the system changes at
 * sundown -- an app that merely reads the preference once gets stuck.
 */

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

/** What `system` currently resolves to. */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "propresenter-garage.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as string[]).includes(value);
}

export function storedTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // Private windows and blocked site data throw on access.
    return null;
  }
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not being able to remember the choice is not worth failing over.
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

/**
 * Put the resolved theme on the root element.
 *
 * The stylesheet keys its dark palette off `.dark`, and `color-scheme` on the
 * same element makes native controls -- the language and theme selects, form
 * fields, scrollbars -- follow the choice rather than the system.
 */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  return resolved;
}

/**
 * Call `onChange` whenever the system preference flips.
 *
 * Returns an unsubscribe function. Only meaningful while the theme is
 * `system`; callers stop listening otherwise.
 */
export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(DARK_QUERY);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches ? "dark" : "light");
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/**
 * The translation core, free of React.
 *
 * Kept separate from the provider so command-line tooling can translate output
 * without pulling a UI framework into a Node script.
 */
import { en, type Dictionary } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";

export const DICTIONARIES: Record<Lang, Dictionary> = { en, fr };
export const LANGUAGES = Object.keys(DICTIONARIES) as Lang[];

function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGUAGES as string[]).includes(value);
}

/**
 * Pick a language from the device's own preferences.
 *
 * `navigator.languages` is ordered by preference, so a reader configured as
 * [de, fr, en] gets French rather than falling straight through to English.
 * Region subtags are ignored: fr-CA, fr-CH and fr all mean French here.
 */
export function detectLanguage(
  preferred: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language]
): Lang {
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export type Params = Record<string, string | number>;

/** Substitute `{name}` placeholders. */
export function interpolate(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in params ? String(params[key]) : whole
  );
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** The active dictionary, accessed by path: `t.audit.heading`. */
  t: Dictionary;
  /** Interpolate a template: `f(t.app.schema, { version })`. */
  f: (template: string, params?: Params) => string;
  /**
   * Choose the right plural form for `n` and interpolate it.
   *
   * Uses `Intl.PluralRules` rather than an `n === 1` test, because the rules
   * genuinely differ: English wants "0 items" while French wants
   * "0 élément" -- singular for zero.
   */
  plural: (forms: readonly string[], n: number, params?: Params) => string;
  /** Wrap text in the locale's quotation marks -- "x" in English, « x » in French. */
  quote: (value: string) => string;
  /** Format a number for the active locale (thousands separators, decimals). */
  num: (value: number) => string;
  /** Join a list of fragments the way the locale does. */
  list: (values: string[]) => string;
}

/**
 * Build a translator for one language.
 *
 * Separate from the provider so it can be exercised without mounting React --
 * the plural and quoting rules are worth testing directly.
 */
export function createI18n(lang: Lang, setLang: (lang: Lang) => void = () => {}): I18n {
  const t = DICTIONARIES[lang];
  const tag = t.meta.localeTag;
  const pluralRules = new Intl.PluralRules(tag);
  const numberFormat = new Intl.NumberFormat(tag);

  return {
    lang,
    setLang,
    t,
    f: interpolate,
    plural: (forms, n, params) => {
      // Dictionaries carry [singular, plural]; map the CLDR category onto that
      // pair, which covers both languages here.
      const form = pluralRules.select(n) === "one" ? forms[0] : forms[forms.length - 1];
      return interpolate(form, { n: numberFormat.format(n), ...params });
    },
    quote: (v) => `${t.meta.quoteOpen}${v}${t.meta.quoteClose}`,
    num: (v) => numberFormat.format(v),
    list: (values) =>
      new Intl.ListFormat(tag, { style: "long", type: "conjunction" }).format(values),
  };
}

/** Keep <html lang> in step, so screen readers and hyphenation follow suit. */
export function applyDocumentLanguage(lang: Lang): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = DICTIONARIES[lang].meta.localeTag;
  }
}

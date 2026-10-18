import type { PlaybackKey } from "../lib/diff";
import type { ModDescriptor } from "../lib/model";
import type { I18n } from "./core";

/**
 * Render structural descriptors as text in the active language.
 *
 * Values that belong to ProPresenter's own vocabulary stay untranslated: effect
 * names ("Adjust Color"), effect variable names ("Brightness=0.2"), enum values
 * ("BEHAVIOR_FILL") and file paths. Translating those would make them harder to
 * match against what ProPresenter itself shows, not easier.
 */
function describeMod({ t, f }: I18n, d: ModDescriptor): string {
  switch (d.kind) {
    case "mirroredHorizontally":
      return t.mods.mirroredHorizontally;
    case "mirroredVertically":
      return t.mods.mirroredVertically;
    case "rotated":
      return f(t.mods.rotated, { degrees: d.degrees });
    case "blurred":
      return t.mods.blurred;
    case "alphaInverted":
      return t.mods.alphaInverted;
    case "cropped":
      return t.mods.cropped;
    case "effect": {
      const label = f(d.enabled ? t.mods.effect : t.mods.effectOff, { name: d.name });
      return d.values.length ? `${label} [${d.values.join(", ")}]` : label;
    }
  }
}

/** Mirroring, crop and effects as one phrase, or "unmodified" when there are none. */
export function describeModsInline(i18n: I18n, descriptors: ModDescriptor[]): string {
  return descriptors.length
    ? descriptors.map((d) => describeMod(i18n, d)).join(", ")
    : i18n.t.diff.unmodified;
}

export function playbackLabel({ t }: I18n, key: PlaybackKey): string {
  return t.playback[key];
}

/** Format a playback value: seconds get a unit, booleans get yes/no. */
export function playbackValue(i18n: I18n, key: PlaybackKey, value: unknown): string {
  const { t, f, num } = i18n;
  if (value === undefined || value === null) return t.playback.none;
  if (typeof value === "boolean") return value ? t.playback.yes : t.playback.no;
  if (typeof value === "number") {
    const rounded = Math.round(value * 1000) / 1000;
    const isDuration = key === "transitionDuration" || key === "loopTime";
    return isDuration ? f(t.playback.seconds, { n: num(rounded) }) : num(rounded);
  }
  // Enum names such as STOP or LOOP_FOR_COUNT come straight from the schema.
  return String(value);
}

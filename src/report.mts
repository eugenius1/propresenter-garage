// Print the audit for a Media file as plain text.
//   npm run report -- /path/to/ProPresenter/Media [--lang=fr]
import fs from "node:fs";
import { checkFidelity, decodeDocument } from "./lib/decode";
import { buildLibrary } from "./lib/model";
import { auditLibrary } from "./lib/audit";
import { createI18n, detectLanguage, LANGUAGES, type Lang } from "./i18n/core";
import { describeModsInline } from "./i18n/describe";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const langArg = args.find((a) => a.startsWith("--lang="))?.split("=")[1];

if (!path) {
  console.error("usage: npm run report -- <path to Media file> [--lang=en|fr]");
  process.exit(1);
}

const lang: Lang = LANGUAGES.includes(langArg as Lang)
  ? (langArg as Lang)
  : detectLanguage(process.env.LANG ? [process.env.LANG.split(".")[0].replace("_", "-")] : []);

const i18n = createI18n(lang);
const { t, f, num, quote, plural } = i18n;

const bytes = new Uint8Array(fs.readFileSync(path));
const lib = buildLibrary(decodeDocument(bytes));
const audit = auditLibrary(lib);
const { fidelity } = checkFidelity(bytes);

const mods = (descriptors: Parameters<typeof describeModsInline>[1]) =>
  describeModsInline(i18n, descriptors);

console.log(path);
console.log(
  `${f(t.library.appOn, { version: lib.appVersion, platform: lib.platform })} · ${fidelity}`
);
console.log(
  [
    plural(t.slots.items, audit.totals.items),
    plural(t.slots.playlists, audit.totals.playlists),
    `${num(audit.totals.video)} ${t.library.video}`,
    `${num(audit.totals.image)} ${t.library.image}`,
    `${num(audit.totals.modified)} ${t.library.modified}`,
  ].join(" · ")
);

console.log(`\n${t.audit.locations.toUpperCase()}`);
for (const row of audit.absolutePathRoots) {
  console.log(`  ${String(row.count).padStart(4)}  ${row.root}`);
}

console.log(`\n${t.audit.withinPlaylist.toUpperCase()}: ${num(audit.withinPlaylistDuplicates.length)}`);
for (const group of audit.withinPlaylistDuplicates) {
  console.log(`  ${num(group.items.length)}x ${group.items[0].relativePath}`);
  console.log(`        ${group.repeatedWithin.join(" · ")}`);
  if (group.labels.length > 1) {
    console.log(`        ${f(t.audit.labelled, { labels: group.labels.map(quote).join(", ") })}`);
  }
}

console.log(`\n${t.audit.crossPlaylist.toUpperCase()}: ${num(audit.crossPlaylistDuplicates.length)}`);
for (const group of audit.crossPlaylistDuplicates.slice(0, 15)) {
  const descriptors = group.items[0].modifications.descriptors;
  console.log(`  ${group.items[0].relativePath}${descriptors.length ? ` [${mods(descriptors)}]` : ""}`);
  console.log(`        ${group.playlists.join(" · ")}`);
}

console.log(`\n${t.audit.variants.toUpperCase()}: ${num(audit.variantGroups.length)}`);
for (const group of audit.variantGroups) {
  console.log(`  ${group.path}`);
  for (const variant of group.variants) {
    const labels = variant.labels.map(quote).join(", ") || t.audit.unnamed;
    const count = variant.count > 1 ? ` x${num(variant.count)}` : "";
    console.log(`     ${labels}${count} — ${mods(variant.modifications)}`);
    console.log(`        ${variant.playlists.join(" · ")}`);
  }
}

console.log(`\n${t.audit.empty.toUpperCase()}: ${num(audit.emptyPlaylists.length)}`);
for (const p of audit.emptyPlaylists) console.log(`  ${p}`);
console.log(`${t.audit.external.toUpperCase()}: ${num(audit.externalVolumeItems.length)}`);
console.log(`${t.audit.hidden.toUpperCase()}: ${num(audit.hiddenItems.length)}`);
console.log(`${t.audit.nameMismatch.toUpperCase()}: ${num(audit.nameMismatches.length)}`);

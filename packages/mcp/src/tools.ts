import path from "node:path";
import { fileURLToPath } from "node:url";
import { examine } from "@propresenter-garage/core/lib/fixes";
import { isPresentationFile } from "@propresenter-garage/core/lib/folder";
import { auditLibrary } from "@propresenter-garage/core/lib/audit";
import { checkFidelity, DecodeError, enumLabel, type Fidelity } from "@propresenter-garage/core/lib/decode";
import { loadMediaBytes } from "@propresenter-garage/core/lib/loadFile";
import {
  applicationInfo,
  itemLabel,
  itemPath,
  LOCAL_ROOT,
  rawChildren,
  rawItems,
  type MediaItem,
} from "@propresenter-garage/core/lib/model";
import { decodePlaylistsDocument } from "@propresenter-garage/core/lib/playlists";
import {
  planStyle,
  presentationStyle,
  StyleError,
  styleSlots,
  themeStyles,
  type SkipReason,
  type SlideStyle,
  type StyleOptions,
} from "@propresenter-garage/core/lib/style";
import {
  checkPresentationFidelity,
  hasText,
  decodePresentation,
  openPresentation,
  readDetails,
  slidesInOrder,
  type PresentationDetails,
  type PresentationDoc,
  type ReadProblem,
  type TextIssue,
} from "@propresenter-garage/core/lib/presentation";
import { fold } from "@propresenter-garage/core/lib/search";
import { createI18n } from "@propresenter-garage/core/i18n/core";
import {
  findMediaBin,
  findPlaylists,
  findPresentations,
  findThemes,
  isFile,
  LibraryError,
  readFoundFile,
  readLibraryFile,
  resolveFolder,
  resolveInRoots,
  statFoundFile,
} from "./library";

/**
 * What each tool returns, as plain data.
 *
 * Kept apart from the server so the answers can be tested without a transport,
 * and so the server is left with nothing to do but describe and route. The
 * shapes are for a model to read: addresses (`slideIndex`, `boxIndex`,
 * `lineIndex`) are the same ones the presentation fixer writes back to, so a
 * later write tool can take exactly what these handed out.
 *
 * Nothing here writes. See `library.ts`.
 */

function presentationName(file: string): string {
  return path.basename(file).replace(/\.pro$/i, "");
}

const { t, f } = createI18n("en");

/**
 * Why a file would not open, in the words the app uses.
 *
 * English, because the reader is a model rather than a person with a language
 * setting; the app's own sentence, so the two never describe one file
 * differently.
 */
function explain(problem: ReadProblem, detail = ""): string {
  const problems = t.tools.presentations.problems;
  return problem === "unreadable" ? f(problems.unreadable, { reason: detail }) : problems[problem];
}

function open(file: string, bytes: Uint8Array) {
  const opened = openPresentation(bytes);
  if (opened.problem) throw new LibraryError(`${file}: ${explain(opened.problem, opened.detail)}`);
  return opened;
}

/**
 * A listing entry. No creation date, on purpose: see `PresentationDetails`.
 *
 * `fileModified` is the file system's, and is free to read. `lastUsed` and
 * `lastModified` are ProPresenter's own and live inside the file, so they are
 * only present when the call asked for them by filtering or sorting on use.
 */
export interface ListedPresentation {
  path: string;
  name: string;
  library: string;
  sizeBytes: number;
  fileModified: string;
  lastUsed?: string | null;
  lastModified?: string;
}

export interface PresentationListing {
  total: number;
  truncated: boolean;
  /** Files that could not be decoded when dates were needed, so they are not silently dropped. */
  unreadable?: string[];
  presentations: ListedPresentation[];
}

export interface ListOptions {
  query?: string;
  limit?: number;
  /** ISO date: only presentations not shown since then, including never shown. */
  notUsedSince?: string;
  /** ISO date: only presentations shown on or after it. */
  usedSince?: string;
  sort?: "name" | "lastUsed";
}

function parseDate(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new LibraryError(`${name} is not a date: ${value}. Use ISO 8601, e.g. 2025-10-24.`);
  return ms;
}

/** How many files the date filters read at once: overlaps the wait on a slow folder. */
const READ_CONCURRENCY = 8;

/** `fn` over `items`, at most `limit` at a time, results in the order of `items`. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Dated = ListedPresentation & { lastUsed: string | null; usedAt: number };

/** A listing entry, from the bytes' own handle when they were read anyway. */
function listed(file: string, size: number, modified: Date): ListedPresentation {
  return {
    path: file,
    name: presentationName(file),
    // ProPresenter keeps one folder per library, so the parent is its name.
    library: path.basename(path.dirname(file)),
    sizeBytes: size,
    fileModified: modified.toISOString(),
  };
}

/** Read when each file was last shown and edited; a file that will not decode is named, not guessed at. */
async function readDates(files: readonly string[]): Promise<{ dated: Dated[]; unreadable: string[] }> {
  const read = await mapLimit(files, READ_CONCURRENCY, async (file): Promise<Dated | string> => {
    try {
      const { bytes, size, modified } = await readFoundFile(file);
      const { lastUsed, lastModified } = readDetails(decodePresentation(bytes));
      return {
        ...listed(file, size, modified),
        lastUsed: lastUsed ?? null,
        lastModified,
        // Parsed once here, for both the filter and the sort.
        usedAt: lastUsed ? Date.parse(lastUsed) : -Infinity,
      };
    } catch {
      return file;
    }
  });
  return {
    dated: read.filter((r): r is Dated => typeof r !== "string"),
    unreadable: read.filter((r): r is string => typeof r === "string"),
  };
}

/**
 * List presentations, by name alone or by when they were last shown.
 *
 * The two cost very differently. A name is the file's name, so a plain listing
 * never opens a file. When a song was last shown is recorded only inside it,
 * so filtering or sorting on use reads and decodes every file the name filter
 * left -- the whole library, unless `query` narrowed it first. The tool
 * description says so, so the calling model can choose.
 */
export async function listPresentations(
  roots: readonly string[],
  { query, limit = 200, notUsedSince, usedSince, sort = "name" }: ListOptions = {}
): Promise<PresentationListing> {
  const before = parseDate(notUsedSince, "notUsedSince");
  const since = parseDate(usedSince, "usedSince");

  const { files, truncated } = await findPresentations(roots);
  const wanted = query ? fold(query) : undefined;
  const named = files.filter((file) => !wanted || fold(presentationName(file)).includes(wanted));

  if (before === undefined && since === undefined && sort !== "lastUsed") {
    const presentations = await Promise.all(
      named.slice(0, limit).map(async (file) => {
        const stat = await statFoundFile(file);
        return stat && listed(file, stat.size, stat.modified);
      })
    );
    return {
      total: named.length,
      truncated: truncated || named.length > limit,
      presentations: presentations.filter((entry) => entry !== undefined),
    };
  }

  const { dated, unreadable } = await readDates(named);
  const matching = dated.filter(
    ({ usedAt }) => (before === undefined || usedAt < before) && (since === undefined || usedAt >= since)
  );
  // Most recent first; never shown last.
  if (sort === "lastUsed") matching.sort((a, b) => b.usedAt - a.usedAt);

  return {
    total: matching.length,
    truncated: truncated || matching.length > limit,
    unreadable,
    presentations: matching.slice(0, limit).map(({ usedAt: _sortKey, ...entry }) => entry),
  };
}

export interface PresentationContent extends PresentationDetails {
  path: string;
  name: string;
  /** The file system's modification time. `lastModified` is ProPresenter's own. */
  fileModified: string;
  slideCount: number;
  /** Whether writing this file back would keep everything in it. See CONTRIBUTING.md. */
  fidelity: Fidelity;
  /** Theme placeholders with no text in them, left out of their slides' `textBoxes`. */
  emptyTextBoxes: number;
  /** Every slide, in ProPresenter's order; one with no text has empty `textBoxes`. */
  slides: {
    slideIndex: number;
    label: string;
    group?: string;
    textBoxes: { boxIndex: number; lines: string[] }[];
  }[];
}

export async function readPresentationFile(roots: readonly string[], file: string): Promise<PresentationContent> {
  const { path: real, bytes, modified } = await readLibraryFile(roots, file);
  const { doc, raw } = open(file, bytes);

  // Every slide, not only those with words: a blank or image-only slide is
  // still one ProPresenter shows, and leaving it out read as a gap in the
  // numbering with nothing to say why.
  const slides: PresentationContent["slides"] = slidesInOrder(raw).map(({ cue, groupName }, slideIndex) => ({
    slideIndex,
    label: cue.name ?? "",
    group: groupName,
    textBoxes: [],
  }));
  let emptyTextBoxes = 0;
  for (const box of doc.textBoxes) {
    if (!hasText(box)) {
      emptyTextBoxes++;
      continue;
    }
    slides[box.slideIndex].textBoxes.push({ boxIndex: box.boxIndex, lines: box.lines.map((line) => line.text) });
  }

  return {
    path: real,
    name: doc.name || presentationName(real),
    fileModified: modified.toISOString(),
    ...readDetails(raw),
    slideCount: doc.slideCount,
    fidelity: checkPresentationFidelity(bytes).fidelity,
    emptyTextBoxes,
    slides,
  };
}

export interface TextMatch {
  path: string;
  name: string;
  slideIndex: number;
  group?: string;
  boxIndex: number;
  lineIndex: number;
  text: string;
}

export interface SearchResult {
  filesSearched: number;
  /** Files that could not be read as presentations, so a miss is not mistaken for absence. */
  unreadable: string[];
  truncated: boolean;
  matches: TextMatch[];
}

/**
 * Find a phrase in the text of every presentation.
 *
 * Accent- and case-insensitive through the same `fold` the app's search uses,
 * so "cene" finds "Cène" here exactly as it does in the browser.
 */
export async function searchText(
  roots: readonly string[],
  { query, folder, limit = 50 }: { query: string; folder?: string; limit?: number }
): Promise<SearchResult> {
  const wanted = fold(query.trim());
  if (!wanted) throw new LibraryError("Search for at least one visible character.");

  const dirs = folder ? [await resolveFolder(roots, folder)] : roots;
  const { files, truncated } = await findPresentations(dirs);
  const matches: TextMatch[] = [];
  const unreadable: string[] = [];

  let searched = 0;
  for (const file of files) {
    searched++;
    let doc: PresentationDoc;
    try {
      doc = open(file, (await readFoundFile(file)).bytes).doc;
    } catch {
      unreadable.push(file);
      continue;
    }
    for (const box of doc.textBoxes) {
      for (const line of box.lines) {
        if (!fold(line.text).includes(wanted)) continue;
        if (matches.length === limit) return { filesSearched: searched, unreadable, truncated: true, matches };
        matches.push({
          path: file,
          name: doc.name || presentationName(file),
          slideIndex: box.slideIndex,
          group: box.groupName,
          boxIndex: box.boxIndex,
          lineIndex: line.index,
          text: line.text,
        });
      }
    }
  }

  return { filesSearched: searched, unreadable, truncated, matches };
}

export interface CheckResult {
  filesChecked: number;
  /** How many of each finding, across every file checked. */
  totals: Partial<Record<TextIssue["kind"], number>>;
  truncated: boolean;
  files: {
    path: string;
    name: string;
    fidelity?: Fidelity;
    /** Set when the file could not be read; `issues` is then empty. */
    error?: string;
    issues: TextIssue[];
  }[];
}

/**
 * The checks the Presentations tool runs, on one file or a whole folder.
 *
 * Goes through `examine`, the very function the browser tool uses, so a model
 * and a person looking at the same file are told the same thing. Only files
 * with something to say are listed; a clean library comes back short.
 */
export async function checkPresentations(
  roots: readonly string[],
  { path: target, limit = 100 }: { path?: string; limit?: number } = {}
): Promise<CheckResult> {
  const resolved = target ? await resolveInRoots(roots, target) : undefined;
  const single = resolved !== undefined && (await isFile(resolved));
  if (single && !isPresentationFile(path.basename(resolved))) {
    throw new LibraryError(`Not a presentation (.pro) file: ${target}`);
  }
  const { files, truncated } = single
    ? { files: [resolved], truncated: false }
    : await findPresentations(resolved ? [resolved] : roots);

  // Truncated either way: a walk that hit its cap left files unchecked, and a
  // list that hit `limit` left findings unlisted. Both mean "not everything".
  const result: CheckResult = { filesChecked: files.length, totals: {}, truncated, files: [] };
  const list = (entry: CheckResult["files"][number]) => {
    if (result.files.length === limit) result.truncated = true;
    else result.files.push(entry);
  };

  for (const file of files) {
    let bytes: Uint8Array;
    try {
      ({ bytes } = await readFoundFile(file));
    } catch (e) {
      // One file that will not open is a finding about that file, not a
      // reason to abandon the other eight hundred.
      if (single) throw e;
      list({ path: file, name: presentationName(file), error: (e as Error).message, issues: [] });
      continue;
    }
    const { report } = examine(path.basename(file), bytes);
    for (const issue of report.issues) {
      result.totals[issue.kind] = (result.totals[issue.kind] ?? 0) + 1;
    }
    if (report.issues.length === 0 && !report.error) continue;
    list({
      path: file,
      name: report.name,
      fidelity: report.error ? undefined : checkPresentationFidelity(bytes).fidelity,
      error: report.error && explain(report.error, report.errorDetail),
      issues: report.issues,
    });
  }
  return result;
}

/**
 * A playlist document of the show folder, found where ProPresenter keeps it
 * unless the caller names one, and decoded.
 *
 * `bytes` is handed back as well, for the fidelity check that is made on the
 * file as it was read, and `target`, the path before symlinks were resolved.
 */
async function loadPlaylistFile<T>(
  roots: readonly string[],
  file: string | undefined,
  find: (roots: readonly string[]) => Promise<string | undefined>,
  missing: string,
  what: string,
  decode: (name: string, bytes: Uint8Array) => T
) {
  const target = file ?? (await find(roots));
  if (!target) throw new LibraryError(missing);
  const { path: real, bytes } = await readLibraryFile(roots, target);
  try {
    return { path: real, target, bytes, decoded: decode(path.basename(real), bytes) };
  } catch (e) {
    if (e instanceof DecodeError) {
      throw new LibraryError(`${target}: not ${what} (${e.code}).`);
    }
    throw e;
  }
}

async function loadMediaBin(roots: readonly string[], file: string | undefined) {
  const { path: real, decoded } = await loadPlaylistFile(
    roots,
    file,
    findMediaBin,
    "No media bin found. Pass the path of the `Media` file inside ProPresenter's `Playlists` folder.",
    "a ProPresenter media bin",
    loadMediaBytes
  );
  return { path: real, loaded: decoded };
}

function compactItem(item: MediaItem) {
  return {
    name: itemLabel(item),
    file: itemPath(item),
    kind: item.kind,
    hidden: item.hidden || undefined,
    modifications: item.modifications.descriptors.length ? item.modifications.descriptors : undefined,
  };
}

export async function readMediaBin(roots: readonly string[], file?: string) {
  const { path: real, loaded } = await loadMediaBin(roots, file);
  const { library } = loaded;
  return {
    path: real,
    appVersion: library.appVersion,
    platform: library.platform,
    fidelity: loaded.fidelity,
    itemCount: library.items.length,
    playlists: library.playlists.map((playlist) => ({
      path: playlist.path,
      items: playlist.items.map(compactItem),
    })),
  };
}

/**
 * The Media Bin tool's audit, with each item cut down to what identifies it.
 *
 * The full `MediaItem` carries playback settings, fingerprints and both paths;
 * a model asking "what is duplicated" needs the name, the file and where it is.
 */
export async function auditMediaBin(roots: readonly string[], file?: string) {
  const { path: real, loaded } = await loadMediaBin(roots, file);
  const audit = auditLibrary(loaded.library);
  const located = (item: MediaItem) => ({ ...compactItem(item), playlist: item.playlistPath });

  return {
    path: real,
    totals: audit.totals,
    withinPlaylistDuplicates: audit.withinPlaylistDuplicates.map((g) => ({
      file: g.filename,
      copies: g.items.length,
      repeatedWithin: g.repeatedWithin,
      labels: g.labels,
    })),
    crossPlaylistDuplicates: audit.crossPlaylistDuplicates.map((g) => ({
      file: g.filename,
      copies: g.items.length,
      playlists: g.playlists,
      layoutDiffers: g.layoutDiffers || undefined,
    })),
    variantGroups: audit.variantGroups,
    emptyPlaylists: audit.emptyPlaylists,
    externalVolumeItems: audit.externalVolumeItems.map(located),
    absolutePathRoots: audit.absolutePathRoots,
    hiddenItems: audit.hiddenItems.map(located),
    nameMismatches: audit.nameMismatches.map((m) => ({ ...located(m.item), filename: m.filename })),
  };
}

/** One entry of a presentation playlist, cut down to what says what it plays. */
export interface PlaylistEntry {
  kind: "presentation" | "header" | "media" | "cue" | "placeholder" | "planningCenter" | "other";
  name: string;
  /** Absolute where the entry says where it is; else as stored. */
  file?: string;
  /** The arrangement a presentation entry plays, when it names one. */
  arrangement?: string;
}

/**
 * The path a URL's `absolute_string` names: a Mac's file URL decoded, a
 * Windows path as it is. Nothing for a URL that does not parse, so the
 * stored relative path is used instead.
 */
function absolutePathOf(url: any): string | undefined {
  const absolute: string | undefined = url?.absolute_string || undefined;
  if (!absolute?.startsWith("file:")) return absolute;
  try {
    return fileURLToPath(absolute);
  } catch {
    return undefined;
  }
}

/**
 * One entry, its file made a path `read_presentation` can open.
 *
 * A path relative to the show folder is joined to it when that folder is
 * known. Any other entry, or one read from a playlists file whose show folder
 * is not, gives the absolute path ProPresenter recorded beside it: a path
 * relative to Documents, say, would otherwise be looked up under the library
 * folders and miss, or find another file of the same name.
 */
function playlistEntry(item: any, showFolder: string | undefined): PlaylistEntry {
  const name: string = item.name ?? "";
  const fileOf = (url: any): string | undefined => {
    const local = url?.local;
    if (showFolder && local?.path && enumLabel(LOCAL_ROOT, local.root) === "SHOW") {
      return path.join(showFolder, local.path);
    }
    return absolutePathOf(url) ?? (local?.path || undefined);
  };
  if (item.presentation) {
    return {
      kind: "presentation",
      name,
      file: fileOf(item.presentation.document_path),
      arrangement: item.presentation.arrangement_name || undefined,
    };
  }
  if (item.header) return { kind: "header", name };
  if (item.cue) {
    const url = item.cue.actions?.find((a: any) => a.media)?.media?.element?.url;
    return url ? { kind: "media", name, file: fileOf(url) } : { kind: "cue", name };
  }
  if (item.placeholder) return { kind: "placeholder", name };
  if (item.planning_center) return { kind: "planningCenter", name };
  return { kind: "other", name };
}

/** Every playlist under `node`, folders flattened into ` / ` paths as the media bin's are. */
function playlistTree(
  node: any,
  showFolder: string | undefined,
  ancestry: string[],
  out: { path: string; items: PlaylistEntry[] }[]
) {
  for (const child of rawChildren(node)) {
    const trail = [...ancestry, child.name ?? ""];
    // A folder holds playlists, not entries; an empty playlist is still listed.
    if (rawChildren(child).length === 0 || rawItems(child).length > 0) {
      out.push({ path: trail.join(" / "), items: rawItems(child).map((item) => playlistEntry(item, showFolder)) });
    }
    playlistTree(child, showFolder, trail, out);
  }
  return out;
}

/**
 * ProPresenter's presentation playlists: the services built from songs,
 * headers and media, as opposed to the media bin.
 *
 * ProPresenter stores a presentation entry's file relative to its own folder,
 * the one holding `Playlists/Library`. That is resolved here, so `file` can be
 * handed straight back to `read_presentation` wherever the server was pointed:
 * at the ProPresenter folder, or at the folder above it.
 *
 * The show folder is known when the file was found where ProPresenter keeps
 * it, or a file the caller named sits in a `Playlists` folder. A copy kept
 * anywhere else says nothing about where the show folder is, and its entries
 * give the absolute paths ProPresenter recorded instead.
 */
export async function readPlaylists(roots: readonly string[], file?: string) {
  const { path: real, target, bytes, decoded } = await loadPlaylistFile(
    roots,
    file,
    findPlaylists,
    "No presentation playlists found. Pass the path of the `Library` file inside ProPresenter's `Playlists` folder.",
    "ProPresenter's presentation playlists",
    (_name, bytes) => decodePlaylistsDocument(bytes)
  );
  // Found, `target` is `<show folder>/Playlists/Library` as built from a root.
  const showFolder =
    file === undefined
      ? path.dirname(path.dirname(target))
      : path.basename(path.dirname(real)) === "Playlists"
        ? path.dirname(path.dirname(real))
        : undefined;
  return {
    path: real,
    ...applicationInfo(decoded.application_info),
    fidelity: checkFidelity(bytes).fidelity,
    playlists: playlistTree(decoded.root_node, showFolder, [], []),
  };
}

/** A `StyleError` in words a model can act on; anything else is not ours to explain. */
function styleProblem(e: unknown, source: string): unknown {
  if (!(e instanceof StyleError)) return e;
  switch (e.code) {
    case "lossy":
      return new LibraryError(`${source}: would not survive being written back, so its look is not copied.`);
    case "noSuchSlide":
      return new LibraryError(`${source} has no slide ${e.params.slide} (slideIndex ${Number(e.params.slide) - 1}).`);
    case "noTextBox":
      return new LibraryError(`The style "${e.params.style}" has no text box to put words in.`);
    default:
      return new LibraryError(`${source}: ${e.message}`);
  }
}

/** A theme's styles, or why they cannot be read, as a `LibraryError` naming `source`. */
function readThemeStyles(bytes: Uint8Array, source: string): SlideStyle[] {
  try {
    return themeStyles(bytes);
  } catch (e) {
    if (e instanceof StyleError) throw styleProblem(e, source);
    throw new LibraryError(`${source}: not a ProPresenter theme (${(e as Error).message}).`);
  }
}

/**
 * The slide styles each theme offers, in the theme's own order.
 *
 * A theme that cannot be read is named with why rather than left out, so an
 * absent theme is never mistaken for one that is not there.
 */
export async function listThemes(roots: readonly string[]) {
  const themes: { name: string; path: string; styles: { styleIndex: number; name: string; textBoxes: number }[] }[] = [];
  const unreadable: { path: string; reason: string }[] = [];
  for (const { name, file } of await findThemes(roots)) {
    try {
      const styles = readThemeStyles((await readFoundFile(file)).bytes, name);
      themes.push({
        name,
        path: file,
        styles: styles.map((style, styleIndex) => ({ styleIndex, name: style.name, textBoxes: styleSlots(style) })),
      });
    } catch (e) {
      unreadable.push({ path: file, reason: (e as Error).message });
    }
  }
  return { themes, unreadable };
}

export interface StyleSource {
  /** A theme's name, as `list_themes` gives it, or the path of its `Theme` file. */
  theme?: string;
  /** A presentation whose slide's look is copied. */
  fromPresentation?: string;
  /** With `theme`: the style's name or `styleIndex`. With `fromPresentation`: the slide's `slideIndex`. */
  style?: string | number;
}

async function loadThemeStyle(roots: readonly string[], theme: string, style: string | number | undefined) {
  const wanted = fold(theme);
  const named = (await findThemes(roots)).find((t) => fold(t.name) === wanted);
  let bytes: Uint8Array;
  try {
    ({ bytes } = await readLibraryFile(roots, named?.file ?? theme));
  } catch (e) {
    if (named || !(e instanceof LibraryError)) throw e;
    throw new LibraryError(`No theme named "${theme}". \`list_themes\` lists the themes there are.`);
  }

  const styles = readThemeStyles(bytes, theme);
  const names = styles.map((s, i) => `${i}: ${s.name}`).join(", ");
  if (style === undefined) {
    if (styles.length === 1) return styles[0];
    throw new LibraryError(`Theme "${theme}" has ${styles.length} styles; pass \`style\` as a name or styleIndex: ${names}.`);
  }
  const found = typeof style === "number" ? styles[style] : styles.find((s) => fold(s.name) === fold(style));
  if (!found) throw new LibraryError(`No style ${JSON.stringify(style)} in theme "${theme}". It has: ${names}.`);
  return found;
}

async function loadStyle(roots: readonly string[], { theme, fromPresentation, style }: StyleSource): Promise<SlideStyle> {
  if (!theme === !fromPresentation) throw new LibraryError("Give exactly one of `theme` and `fromPresentation`.");
  if (theme) return loadThemeStyle(roots, theme, style);

  if (typeof style !== "number") {
    throw new LibraryError("With `fromPresentation`, `style` is the slideIndex of the slide to copy, as read_presentation gives it.");
  }
  const { bytes } = await readLibraryFile(roots, fromPresentation!);
  open(fromPresentation!, bytes);
  try {
    return presentationStyle(bytes, style);
  } catch (e) {
    throw styleProblem(e, fromPresentation!);
  }
}

export interface StylePreview {
  path: string;
  style: string;
  /** Whether the presentation would survive being written back. Applying is refused when it would not. */
  fidelity: Fidelity;
  restyled: number;
  leftAlone: number;
  slides: {
    slideIndex: number;
    label: string;
    group?: string;
    macros?: string[];
    /** Why the slide would be left alone, when it would. */
    skip?: SkipReason;
    /**
     * The text each of the style's boxes would carry afterwards, filled in
     * order. No `boxIndex`: the boxes are the style's, not the slide's own.
     */
    textBoxes: { lines: string[] }[];
  }[];
}

/**
 * What giving a presentation's slides another slide's look would do, without
 * doing it: which slides would change, which would be left alone and why, and
 * the text each would carry.
 *
 * The plan `applyStyle` itself follows and then checks its result against, so
 * the preview and a later write cannot disagree. There is no write here: that
 * would be a fifth write path, and AGENTS.md says what one has to keep.
 */
export async function previewStyle(
  roots: readonly string[],
  { path: file, theme, fromPresentation, style, ...options }: StyleSource & StyleOptions & { path: string }
): Promise<StylePreview> {
  const { path: real, bytes } = await readLibraryFile(roots, file);
  const { raw } = open(file, bytes);
  const slideStyle = await loadStyle(roots, { theme, fromPresentation, style });

  let plan;
  try {
    plan = planStyle(raw, slideStyle, options);
  } catch (e) {
    throw styleProblem(e, file);
  }
  const restyled = plan.filter((slide) => !slide.skip).length;
  return {
    path: real,
    style: slideStyle.name,
    fidelity: checkPresentationFidelity(bytes).fidelity,
    restyled,
    leftAlone: plan.length - restyled,
    slides: plan.map((slide) => ({
      slideIndex: slide.slideIndex,
      label: slide.cueName,
      group: slide.groupName,
      macros: slide.macros.length ? slide.macros : undefined,
      skip: slide.skip,
      textBoxes: slide.textBoxes.map((lines) => ({ lines })),
    })),
  };
}

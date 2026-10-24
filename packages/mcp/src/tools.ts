import fs from "node:fs/promises";
import path from "node:path";
import { examine } from "@propresenter-garage/core/lib/fixes";
import { isPresentationFile } from "@propresenter-garage/core/lib/folder";
import { auditLibrary } from "@propresenter-garage/core/lib/audit";
import { DecodeError, type Fidelity } from "@propresenter-garage/core/lib/decode";
import { loadMediaBytes } from "@propresenter-garage/core/lib/loadFile";
import { itemLabel, itemPath, type MediaItem } from "@propresenter-garage/core/lib/model";
import {
  checkPresentationFidelity,
  hasText,
  decodePresentation,
  openPresentation,
  readDetails,
  type PresentationDetails,
  type PresentationDoc,
  type ReadProblem,
  type TextIssue,
} from "@propresenter-garage/core/lib/presentation";
import { fold } from "@propresenter-garage/core/lib/search";
import { createI18n } from "@propresenter-garage/core/i18n/core";
import {
  findMediaBin,
  findPresentations,
  LibraryError,
  readFoundFile,
  readLibraryFile,
  resolveFolder,
  resolveInRoots,
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
  const needDates = before !== undefined || since !== undefined || sort === "lastUsed";

  const { files, truncated } = await findPresentations(roots);
  const wanted = query ? fold(query) : undefined;
  const named = files.filter((file) => !wanted || fold(presentationName(file)).includes(wanted));

  let matching: { file: string; details?: PresentationDetails }[] = named.map((file) => ({ file }));
  const unreadable: string[] = [];
  if (needDates) {
    matching = [];
    for (const file of named) {
      let details: PresentationDetails;
      try {
        details = readDetails(decodePresentation(await readFoundFile(file)));
      } catch {
        unreadable.push(file);
        continue;
      }
      const used = details.lastUsed ? Date.parse(details.lastUsed) : undefined;
      if (before !== undefined && used !== undefined && used >= before) continue;
      if (since !== undefined && (used === undefined || used < since)) continue;
      matching.push({ file, details });
    }
    if (sort === "lastUsed") {
      // Most recent first; never shown last.
      const usedAt = (m: (typeof matching)[number]) => (m.details?.lastUsed ? Date.parse(m.details.lastUsed) : -Infinity);
      matching.sort((a, b) => usedAt(b) - usedAt(a));
    }
  }

  return {
    total: matching.length,
    truncated: truncated || matching.length > limit,
    unreadable: needDates ? unreadable : undefined,
    presentations: (
      await Promise.all(
        matching.slice(0, limit).map(async ({ file, details }) => {
          // ProPresenter saves by replacing the file; one caught mid-save is
          // left out rather than failing the whole listing.
          const stat = await fs.stat(file).catch(() => undefined);
          return stat && {
            path: file,
            name: presentationName(file),
            // ProPresenter keeps one folder per library, so the parent is its name.
            library: path.basename(path.dirname(file)),
            sizeBytes: stat.size,
            fileModified: stat.mtime.toISOString(),
            ...(details && { lastUsed: details.lastUsed ?? null, lastModified: details.lastModified }),
          };
        })
      )
    ).filter((entry) => entry !== undefined),
  };
}

export interface PresentationContent extends PresentationDetails {
  path: string;
  name: string;
  /** The file system's modification time. `lastModified` is ProPresenter's own. */
  fileModified?: string;
  slideCount: number;
  /** Whether writing this file back would keep everything in it. See CONTRIBUTING.md. */
  fidelity: Fidelity;
  /** Theme placeholders with no text in them, left out of `slides`. */
  emptyTextBoxes: number;
  slides: {
    slideIndex: number;
    label: string;
    group?: string;
    textBoxes: { boxIndex: number; lines: string[] }[];
  }[];
}

export async function readPresentationFile(roots: readonly string[], file: string): Promise<PresentationContent> {
  const { path: real, bytes } = await readLibraryFile(roots, file);
  const { doc, raw } = open(file, bytes);
  // Replaced mid-save between the read and this: report the rest regardless.
  const stat = await fs.stat(real).catch(() => undefined);

  const slides = new Map<number, PresentationContent["slides"][number]>();
  let emptyTextBoxes = 0;
  for (const box of doc.textBoxes) {
    if (!hasText(box)) {
      emptyTextBoxes++;
      continue;
    }
    let slide = slides.get(box.slideIndex);
    if (!slide) {
      slide = { slideIndex: box.slideIndex, label: box.cueName, group: box.groupName, textBoxes: [] };
      slides.set(box.slideIndex, slide);
    }
    slide.textBoxes.push({ boxIndex: box.boxIndex, lines: box.lines.map((line) => line.text) });
  }

  return {
    path: real,
    name: doc.name || presentationName(real),
    fileModified: stat?.mtime.toISOString(),
    ...readDetails(raw),
    slideCount: doc.slideCount,
    fidelity: checkPresentationFidelity(bytes).fidelity,
    emptyTextBoxes,
    slides: [...slides.values()],
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
      doc = open(file, await readFoundFile(file)).doc;
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
  const single = resolved !== undefined && (await fs.stat(resolved)).isFile();
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
      bytes = await readFoundFile(file);
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

async function loadMediaBin(roots: readonly string[], file: string | undefined) {
  const target = file ?? (await findMediaBin(roots));
  if (!target) {
    throw new LibraryError("No media bin found. Pass the path of the `Media` file inside ProPresenter's `Playlists` folder.");
  }
  const { path: real, bytes } = await readLibraryFile(roots, target);
  try {
    return { path: real, loaded: loadMediaBytes(path.basename(real), bytes) };
  } catch (e) {
    if (e instanceof DecodeError) {
      throw new LibraryError(`${target}: not a ProPresenter media bin (${e.code}).`);
    }
    throw e;
  }
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

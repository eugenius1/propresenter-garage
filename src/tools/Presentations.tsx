// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import {
  folderAccess,
  isPresentationFile,
  pickFolder,
  readFolderFromInput,
  readFolderHandle,
  type FolderFile,
} from "../lib/folder";
import {
  forget,
  handlePermission,
  keep,
  KEYS,
  remember,
  requestHandlePermission,
} from "../lib/persistence";
import { download, stamp } from "../lib/download";
import {
  examine,
  fixFiles,
  planFixes,
  type Examined,
  type FixOutcome,
  type LineFix,
} from "../lib/fixes";
import type { TextIssue, TextIssueKind, TrailingPunctuation } from "../lib/presentation";
import { zip } from "../lib/zip";
import { useI18n } from "../i18n";

/**
 * Every kind the checker reports, and the ones shown without being asked for.
 *
 * Trailing punctuation is always detected -- it costs one test per line -- but
 * stays out of the way until it is switched on. Detecting it regardless is
 * what makes the switch instant: it filters what is already in hand rather
 * than sending the whole library back through the reader.
 *
 * One switch each rather than one for all three. They are not one decision: a
 * library of 24,181 lines ends 999 of them with a full stop and 43 with a
 * semicolon, and a house that strips commas may well keep the full stop that
 * closes a verse.
 */
const ALL_KINDS: TextIssueKind[] = [
  "leadingSpace",
  "trailingSpace",
  "blankLine",
  "repeatedSpace",
  "trailingComma",
  "trailingSemicolon",
  "trailingFullStop",
];
const OPTIONAL_KINDS: readonly TrailingPunctuation[] = [
  "trailingComma",
  "trailingSemicolon",
  "trailingFullStop",
];
/** The same set, for asking whether a kind is one of them. */
const OPTIONAL = new Set<TextIssueKind>(OPTIONAL_KINDS);

/**
 * Let the browser paint, at most once a frame.
 *
 * Reading, decoding, editing and re-encoding a file are quick enough that a
 * run of several hundred never gives the main thread back on its own: the
 * awaits inside it resolve as microtasks, so React flushes the progress state
 * and nothing is drawn. Measured on a real run of 57 files, the bar painted
 * three times -- it showed 14, then 56, then disappeared.
 *
 * Yielding on every file would cost more than it buys: `setTimeout` is clamped
 * to about four milliseconds, which on a whole library is seconds of waiting
 * added to make a bar move. So the main thread goes back only once the frame
 * it would have been drawn in has passed, and through `scheduler.yield` where
 * the browser has it, which returns without the clamp.
 */
function painter() {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  let last = performance.now();

  return async () => {
    const now = performance.now();
    if (now - last < 16) return;
    last = now;
    if (scheduler?.yield) await scheduler.yield();
    else await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

/** How far a run has got, and which phase it is. */
interface Progress {
  /** The phase's template: "Saving {n}…", "Backing up {n}…", "Fixing {n}…". */
  verb: string;
  path: string;
  /** Files finished, and how many there are altogether. */
  done: number;
  total: number;
}

/** One line of one file, as the list shows it and the fix run names it. */
interface Row {
  key: string;
  slideIndex: number;
  lineIndex: number;
  groupName?: string;
  text: string;
  kinds: TextIssueKind[];
  fix?: LineFix;
}

/** Address a line uniquely across the whole library. */
const rowKey = (filename: string, boxIndex: number, lineIndex: number) =>
  `${filename} ${boxIndex}:${lineIndex}`;

/**
 * Gather the findings on one line into a single row.
 *
 * One line can be guilty of three things at once, and listing it three times
 * asks the reader to approve three edits to the same characters. One row, one
 * before, one after, one decision.
 */
function rowsOf(filename: string, issues: TextIssue[], fixes: LineFix[]): Row[] {
  const byLine = new Map<string, Row>();
  const fixFor = new Map(fixes.map((fix) => [rowKey(filename, fix.boxIndex, fix.lineIndex), fix]));

  for (const issue of issues) {
    const key = rowKey(filename, issue.boxIndex, issue.lineIndex);
    const existing = byLine.get(key);
    if (existing) {
      existing.kinds.push(issue.kind);
      continue;
    }
    byLine.set(key, {
      key,
      slideIndex: issue.slideIndex,
      lineIndex: issue.lineIndex,
      groupName: issue.groupName,
      text: issue.text,
      kinds: [issue.kind],
      fix: fixFor.get(key),
    });
  }

  return [...byLine.values()];
}

/**
 * Check the text of every presentation in a library, and put it right.
 *
 * Reads a whole folder at once, because the problems it looks for are the kind
 * nobody finds by opening thirty songs one at a time: a space at the start of a
 * line that shifts it right, a space at the end that spoils centring, a
 * paragraph that shows nothing but still takes up room.
 *
 * Writing is three deliberate acts rather than one button. The reader chooses
 * which lines; they take a backup of those files as they stand; only then does
 * the fix button do anything. Each file is checked against the schema and read
 * back after editing before it reaches the folder, so one that cannot be
 * written faithfully is left exactly as it was.
 */
export function Presentations() {
  const { t, f, num, plural } = useI18n();
  const p = t.tools.presentations;

  // What this browser can do with a folder does not change while it is open.
  const access = useMemo(() => folderAccess(), []);
  const input = useRef<HTMLInputElement>(null);

  const [scanned, setScanned] = useState<Examined[] | null>(null);
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [handle, setHandle] = useState<unknown>(null);
  const [folderName, setFolderName] = useState<string>("");
  const [fellBack, setFellBack] = useState(false);
  /** A remembered folder whose permission has lapsed and needs one click back. */
  const [pending, setPending] = useState<{ handle: unknown; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<TextIssueKind>>(new Set(ALL_KINDS));
  /** Opt-in checks, remembered so the choices survive a refresh. */
  const [optional, setOptional] = useState<Set<TextIssueKind>>(new Set());

  /**
   * The lines the reader has taken *out* of the run, rather than the ones left
   * in.
   *
   * Pressing a filter or switching a check on changes which fixes exist, and a
   * set of exclusions survives that where a set of inclusions would quietly
   * drop whatever appeared since.
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [backup, setBackup] = useState<{ name: string; paths: Set<string> } | null>(null);
  const [outcomes, setOutcomes] = useState<FixOutcome[] | null>(null);
  const [savedZip, setSavedZip] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  /**
   * Whether a run is under way, and how far through it is.
   *
   * A library is hundreds of files and every one is decoded, edited,
   * re-encoded and read back, so a run lasts long enough that a reader needs
   * to see it moving. Kept as a count rather than a fraction so the caption
   * can say "12 of 57" -- a bar alone shows that something is happening but
   * not how much of it is left.
   */
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  /**
   * The files in alphabetical order.
   *
   * Sorted here rather than in the scan because the order is a display
   * decision and depends on the language: a collator puts "élever" beside
   * "elever" rather than after "z", and `numeric` keeps "Psaume 9" ahead of
   * "Psaume 10". Doing it at render means switching language re-sorts rather
   * than leaving the previous locale's order on screen.
   *
   * By the name on screen rather than by the filename, because those are not
   * the same thing: the heading is the presentation's own name, which a reader
   * can change without renaming the file. Sorting by the path would leave a
   * list that is ordered by something invisible and looks wrong. The path
   * breaks ties, so two songs of the same name always sit in the same order.
   */
  const collator = useMemo(
    () => new Intl.Collator(t.meta.localeTag, { numeric: true, sensitivity: "base" }),
    [t.meta.localeTag]
  );

  const examined = useMemo(() => {
    const label = (one: Examined) => one.report.name || one.report.filename;
    return [...(scanned ?? [])].sort(
      (a, b) =>
        collator.compare(label(a), label(b)) ||
        collator.compare(a.report.filename, b.report.filename)
    );
  }, [scanned, collator]);

  const reports = useMemo(() => examined.map((one) => one.report), [examined]);

  /**
   * The folder each file sits in, shown only when they do not all share one.
   *
   * A library kept in subfolders can hold two songs of the same name, and the
   * heading is the presentation's own name rather than its filename -- so
   * without this there would be no way to tell them apart. Judged across every
   * file scanned rather than only those with findings, so the folder does not
   * appear and disappear as the filters change.
   */
  const folderOf = (filename: string) => filename.split("/").slice(0, -1).join("/");

  const showFolders = useMemo(
    () => new Set(reports.map((r) => folderOf(r.filename))).size > 1,
    [reports]
  );

  const folderLabel = (filename: string) =>
    [folderName, folderOf(filename)].filter(Boolean).join("/");

  const kinds = useMemo(
    () => ALL_KINDS.filter((kind) => !OPTIONAL.has(kind) || optional.has(kind)),
    [optional]
  );
  /** The kinds both switched on and not filtered out by a pill. */
  const shown = useMemo(() => new Set(kinds.filter((kind) => active.has(kind))), [kinds, active]);

  /** Whether anything could be written back at all, before the reader chooses. */
  const canWrite = access === "readwrite" && handle !== null;

  function clearRun() {
    setBackup(null);
    setOutcomes(null);
    setSavedZip(null);
    setFixError(null);
  }

  async function scan(list: FolderFile[]) {
    const out: Examined[] = [];
    for (const file of list) {
      setBusy(file.name);
      out.push(examine(file.path, await file.read()));
    }
    setBusy(null);
    setScanned(out);
    setExcluded(new Set());
  }

  /**
   * Pick up where the last visit left off.
   *
   * A directory handle survives in IndexedDB, but permission may not: in an
   * ordinary tab it lapses once the last tab for the origin closes, while an
   * installed app keeps it. Where it is still granted the folder is simply
   * reread; where it is not, asking again needs a user gesture, so the folder
   * is offered as a button rather than re-requested on load.
   */
  useEffect(() => {
    void (async () => {
      // A record rather than a flag, so a dictionary that gains another
      // optional check reads back what was stored before it existed.
      const saved = await remember<Partial<Record<TextIssueKind, boolean>>>(
        KEYS.presentationsChecks
      );
      if (saved) setOptional(new Set<TextIssueKind>(OPTIONAL_KINDS.filter((k) => saved[k])));
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const saved = await remember<unknown>(KEYS.presentationsFolder);
      if (!saved || cancelled) return;

      const name = (saved as { name?: string }).name ?? "";
      if ((await handlePermission(saved, "read")) === "granted") {
        try {
          const folder = await readFolderHandle(saved, isPresentationFile);
          if (cancelled) return;
          setFolderName(folder.name);
          setFiles(folder.files);
          setHandle(saved);
          await scan(folder.files);
          return;
        } catch {
          // The folder may have moved or been removed since.
          await forget(KEYS.presentationsFolder);
          return;
        }
      }

      if (!cancelled) setPending({ handle: saved, name });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reopen() {
    if (!pending) return;
    if ((await requestHandlePermission(pending.handle, "read")) !== "granted") return;
    try {
      const folder = await readFolderHandle(pending.handle, isPresentationFile);
      setPending(null);
      clearRun();
      setFolderName(folder.name);
      setFiles(folder.files);
      setHandle(pending.handle);
      await scan(folder.files);
    } catch (e) {
      setPending(null);
      setError((e as Error).message);
    }
  }

  function forgetFolder() {
    setPending(null);
    setFellBack(false);
    setError(null);
    setScanned(null);
    setFiles([]);
    setHandle(null);
    setFolderName("");
    clearRun();
    void forget(KEYS.presentationsFolder);
  }

  async function chooseFolder() {
    setError(null);
    setFellBack(false);
    try {
      const folder = await pickFolder(isPresentationFile, { write: false });
      if (!folder) return;
      setPending(null);
      clearRun();
      setFolderName(folder.name);
      setFiles(folder.files);
      setHandle(folder.handle ?? null);
      // Only a real handle is worth keeping; the input fallback hands over
      // copies with no path back to the folder.
      if (folder.handle) void keep(KEYS.presentationsFolder, folder.handle);
      await scan(folder.files);
    } catch (e) {
      setBusy(null);
      // The picker can be unavailable for reasons the reader cannot act on --
      // an embedded frame, a policy, a browser that claims the API and then
      // refuses. Falling back to the directory input gets them a result
      // instead of an error, at the cost of not being able to write back.
      setFellBack(true);
      setError(null);
      input.current?.click();
      void e;
    }
  }

  /** The picker where this browser has one, the directory input otherwise. */
  const choose = () => (access === "readwrite" ? void chooseFolder() : input.current?.click());

  const withIssues = useMemo(
    () => reports.filter((r) => r.issues.some((i) => shown.has(i.kind)) || r.error),
    [reports, shown]
  );

  const totalIssues = useMemo(
    () => reports.reduce((n, r) => n + r.issues.filter((i) => shown.has(i.kind)).length, 0),
    [reports, shown]
  );

  const countOf = (kind: TextIssueKind) =>
    reports.reduce((n, r) => n + r.issues.filter((i) => i.kind === kind).length, 0);

  /**
   * What is wrong and what could be done about it, file by file.
   *
   * Recomputed from the boxes kept during the scan rather than by reading the
   * folder again, so pressing a filter stays instant on a library of hundreds.
   */
  const rows = useMemo(() => {
    const byFile = new Map<string, Row[]>();
    for (const { report, fixable } of examined) {
      const issues = report.issues.filter((i) => shown.has(i.kind));
      if (issues.length === 0) continue;
      byFile.set(report.filename, rowsOf(report.filename, issues, planFixes(fixable, issues)));
    }
    return byFile;
  }, [examined, shown]);

  /** The fixes still ticked, grouped by file, in the order they were listed. */
  const chosen = useMemo(
    () =>
      [...rows]
        .map(([path, lines]) => ({
          path,
          fixes: lines.filter((row) => row.fix && !excluded.has(row.key)).map((row) => row.fix!),
        }))
        .filter((plan) => plan.fixes.length > 0),
    [rows, excluded]
  );

  const chosenLines = useMemo(() => chosen.reduce((n, plan) => n + plan.fixes.length, 0), [chosen]);
  const fixableLines = useMemo(
    () => [...rows.values()].reduce((n, lines) => n + lines.filter((r) => r.fix).length, 0),
    [rows]
  );

  /** Whether the backup on hand covers every file about to be written. */
  const backedUp = backup !== null && chosen.every((plan) => backup.paths.has(plan.path));

  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const toggle = (kind: TextIssueKind) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      // Switching every pill off would show nothing at all, so it means "all".
      return kinds.some((k) => next.has(k)) ? next : new Set(ALL_KINDS);
    });

  function toggleOptional(kind: TrailingPunctuation, on: boolean) {
    const next = new Set(optional);
    if (on) next.add(kind);
    else next.delete(kind);
    setOptional(next);
    // Turning one on should show it, even if the pill was switched off before.
    if (on) setActive((prev) => new Set(prev).add(kind));
    void keep(
      KEYS.presentationsChecks,
      Object.fromEntries(OPTIONAL_KINDS.map((k) => [k, next.has(k)]))
    );
  }

  function toggleRow(key: string) {
    setOutcomes(null);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setFileSelected(filename: string, on: boolean) {
    setOutcomes(null);
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const row of rows.get(filename) ?? []) {
        if (!row.fix) continue;
        if (on) next.delete(row.key);
        else next.add(row.key);
      }
      return next;
    });
  }

  function setAllSelected(on: boolean) {
    setOutcomes(null);
    if (on) {
      setExcluded(new Set());
      return;
    }
    const every = new Set<string>();
    for (const lines of rows.values()) for (const row of lines) if (row.fix) every.add(row.key);
    setExcluded(every);
  }

  /** The files about to change, exactly as they stand, as one archive. */
  async function downloadBackup() {
    setFixError(null);
    setRunning(true);
    try {
      const entries: { path: string; bytes: Uint8Array }[] = [];
      const paint = painter();
      for (const [index, plan] of chosen.entries()) {
        setProgress({ verb: p.backingUp, path: plan.path, done: index, total: chosen.length });
        await paint();
        const file = fileByPath.get(plan.path);
        if (file) entries.push({ path: plan.path, bytes: await file.read() });
      }
      // Compressing the lot gets no step of its own: a whole library is 37 MB
      // of presentations and deflates in under three hundred milliseconds.
      const name = `propresenter-backup-${stamp()}.zip`;
      download(name, await zip(entries), "application/zip");
      setBackup({ name, paths: new Set(entries.map((entry) => entry.path)) });
    } catch (e) {
      setFixError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const readFile = async (path: string) => {
    const file = fileByPath.get(path);
    if (!file) throw new Error(path);
    return file.read();
  };

  async function saveFixes() {
    setFixError(null);
    // Scanning only ever asked to read. Writing is a separate promise, made
    // here where the reader has just asked for it and a gesture is in hand.
    if ((await requestHandlePermission(handle, "readwrite")) !== "granted") {
      setFixError(p.permissionNeeded);
      return;
    }

    setRunning(true);
    try {
      const paint = painter();
      const result = await fixFiles(chosen, {
        read: readFile,
        write: async (path, bytes) => {
          const file = fileByPath.get(path);
          if (!file?.write) throw new Error(path);
          await file.write(bytes);
        },
        onFile: async (path, done, total) => {
          setProgress({ verb: p.applying, path, done, total });
          await paint();
        },
      });
      setOutcomes(result);
      // The backup describes files that no longer look like that.
      setBackup(null);
      // Read the folder again, so what is on screen is what is on disk.
      await scan(files);
    } catch (e) {
      setFixError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  /** The fallback where nothing can be written: hand over corrected copies. */
  async function downloadFixed() {
    setFixError(null);
    setRunning(true);
    try {
      const paint = painter();
      const result = await fixFiles(chosen, {
        read: readFile,
        onFile: async (path, done, total) => {
          setProgress({ verb: p.fixing, path, done, total });
          await paint();
        },
      });
      const entries = result
        .filter((outcome) => outcome.bytes)
        .map((outcome) => ({ path: outcome.path, bytes: outcome.bytes! }));
      const name = `propresenter-fixed-${stamp()}.zip`;
      download(name, await zip(entries), "application/zip");
      setOutcomes(result);
      setSavedZip(name);
    } catch (e) {
      setFixError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  const saved = outcomes?.filter((outcome) => !outcome.reason) ?? [];
  const refused = outcomes?.filter((outcome) => outcome.reason) ?? [];

  return (
    <>
      <div className="card">
        <h2>{p.name}</h2>
        <p className="sub">{p.chooseHint}</p>

        <div className="editor-bar">
          {/* Once a folder is chosen it replaces the button, so what is loaded
              is on screen rather than implied. Only its name: the browser
              never reveals where the folder sits on disk, by design. */}
          {folderName ? (
            <>
              <span className="chosen">
                <FolderOpen size={15} aria-hidden="true" />
                <span className="chosen-name">{folderName}</span>
              </span>
              <button className="btn" onClick={choose} disabled={busy !== null}>
                {p.changeFolder}
              </button>
              <button
                className="btn icon"
                aria-label={p.clearFolder}
                title={p.clearFolder}
                onClick={forgetFolder}
                disabled={busy !== null}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </>
          ) : (
            /* One button, whichever route this browser supports. Offering both
               the picker and the input produced two controls with the same
               label and no way to tell them apart. */
            <button className="btn primary" onClick={choose} disabled={busy !== null}>
              {access === "unavailable" ? p.pickFiles : p.pickFolder}
            </button>
          )}
          <input
            ref={input}
            type="file"
            hidden
            multiple
            // Reading a folder this way works in every browser, including the
            // ones with no directory picker -- it just cannot write back.
            {...(access === "unavailable" ? {} : { webkitdirectory: "" })}
            onChange={(e) => {
              const picked = e.target.files;
              if (!picked) return;
              setError(null);
              clearRun();
              const folder = readFolderFromInput(picked, isPresentationFile);
              setFolderName(folder.name);
              setFiles(folder.files);
              setHandle(null);
              void scan(folder.files);
            }}
          />
          {busy && <span className="editor-count">{f(p.scanning, { n: busy })}</span>}
        </div>

        {/* The opt-in checks, offered where the folder is chosen rather than
            among the findings: they change what counts as a problem, which is
            a decision made before reading rather than while sifting. */}
        {OPTIONAL_KINDS.map((kind) => (
          <label className="option" key={kind} title={p.optionalWhy[kind]}>
            <input
              type="checkbox"
              checked={optional.has(kind)}
              onChange={(e) => toggleOptional(kind, e.target.checked)}
            />
            <span>{p.optionalChecks[kind]}</span>
          </label>
        ))}

        <p className="why">
          {access === "readwrite"
            ? p.readwriteNote
            : access === "readonly"
              ? p.readonlyNote
              : p.unavailableNote}{" "}
          {access === "readwrite" && p.installNote}
        </p>

        {pending && (
          <div className="editor-bar" style={{ paddingTop: 0 }}>
            <span className="editor-count">{f(p.remembered, { folder: pending.name })}</span>
            <span className="spacer" />
            <button className="btn primary" onClick={() => void reopen()}>
              {f(p.reconnect, { folder: pending.name })}
            </button>
            <button className="btn" onClick={forgetFolder}>
              {p.forgetFolder}
            </button>
          </div>
        )}
        {pending && <p className="why">{p.reconnectWhy}</p>}
        {fellBack && <p className="why warn-inline">{p.pickerFailed}</p>}
        {error && <p className="why warn-inline">{error}</p>}

        {scanned && reports.length === 0 && (
          <p className="sub warn-inline">{f(p.noneFound, { folder: folderName || "—" })}</p>
        )}
      </div>

      {reports.length > 0 && (
        <div className="card">
          <h2>{p.summary}</h2>
          <div className="stats">
            <div className="stat">
              <div className="n">{num(reports.length)}</div>
              <div className="l">{p.name}</div>
            </div>
            {kinds.map((kind) => (
              <div className="stat" key={kind}>
                <div className="n">{num(countOf(kind))}</div>
                <div className="l">{p.kinds[kind]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Above the findings rather than below them: on a library of hundreds
          the list is long, and a control at the bottom of it is a control
          nobody finds. It stays on screen after a run that leaves nothing to
          fix, because that is exactly when the reader wants to know what
          happened. */}
      {(fixableLines > 0 || outcomes) && (
        <div className="card">
          <h2>{p.fix}</h2>
          <p className="sub">{p.fixHint}</p>

          <div className="editor-bar">
            <span className="editor-count">
              {plural(p.fixable, chosenLines)} {plural(p.inFilesFix, chosen.length)}
            </span>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => setAllSelected(excluded.size > 0)}
              disabled={running}
            >
              {excluded.size > 0 ? p.selectAll : p.selectNone}
            </button>

            {canWrite ? (
              <>
                <button
                  className={backedUp ? "btn" : "btn primary"}
                  onClick={() => void downloadBackup()}
                  disabled={chosenLines === 0 || running}
                >
                  {p.downloadBackup}
                </button>
                <button
                  className="btn primary"
                  onClick={() => void saveFixes()}
                  disabled={!backedUp || chosenLines === 0 || running}
                >
                  {plural(p.applyFixes, chosenLines)}
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                onClick={() => void downloadFixed()}
                disabled={chosenLines === 0 || running}
              >
                {p.downloadFixed}
              </button>
            )}
          </div>

          {progress && <ProgressBar progress={progress} />}

          <p className="why">
            {!canWrite
              ? p.downloadFixedWhy
              : backup
                ? backedUp
                  ? f(p.backupDone, { name: backup.name })
                  : p.backupStale
                : `${plural(p.backupCount, chosen.length)}. ${p.backupWhy}`}
          </p>

          {savedZip && <p className="why">{f(p.downloadedFixed, { name: savedZip })}</p>}
          {fixError && <p className="why warn-inline">{fixError}</p>}

          {outcomes && (
            <p className="sub">
              {saved.length > 0 ? plural(p.fixedFiles, saved.length) : p.fixedNone}
              {refused.length > 0 && ` · ${plural(p.fixFailed, refused.length)}`}
            </p>
          )}
          {refused.length > 0 && (
            <ul className="rows">
              {refused.map((outcome) => (
                <li key={outcome.path}>
                  <span className="path">{outcome.path}</span>{" "}
                  <span className="node-count">{p.refusals[outcome.reason!]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <div className="card">
          <h2>
            {totalIssues === 0
              ? p.clean
              : plural(p.issuesFound, totalIssues, {
                  files: plural(p.inFiles, withIssues.length),
                })}
          </h2>
          <p className="sub">{p.emptyBoxesNote}</p>

          <div className="filters">
            {kinds.map((kind) => (
              <button
                key={kind}
                className="pill"
                aria-pressed={active.has(kind)}
                disabled={countOf(kind) === 0}
                title={p.why[kind]}
                onClick={() => toggle(kind)}
              >
                {p.kinds[kind]} {num(countOf(kind))}
              </button>
            ))}
          </div>

          {withIssues.map((report) => {
            const lines = rows.get(report.filename) ?? [];
            const fixable = lines.filter((row) => row.fix);
            const allOn = fixable.length > 0 && fixable.every((row) => !excluded.has(row.key));

            return (
              <div className="finding" key={report.filename}>
                <h3>
                  {showFolders && (
                    <span className="finding-folder">{folderLabel(report.filename)}</span>
                  )}
                  {report.name || report.filename}
                  <span className="count-badge">{report.error ? "!" : num(lines.length)}</span>
                </h3>
                <p className="why">
                  {report.error
                    ? f(p.unreadable, { reason: report.error })
                    : f(p.slidesAndBoxes, {
                        slides: num(report.slideCount),
                        empty: num(report.emptyTextBoxes),
                      })}
                </p>

                {fixable.length > 0 && (
                  <label className="option">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={(e) => setFileSelected(report.filename, e.target.checked)}
                      disabled={running}
                    />
                    <span>{p.selectFile}</span>
                  </label>
                )}

                {!report.error && (
                  <ul className="rows">
                    {lines.map((row) => (
                      <li key={row.key}>
                        <div className="fix-head">
                          {row.fix && (
                            <input
                              type="checkbox"
                              // Named by where the line is rather than by what
                              // it says: the text is on screen beside it, and
                              // a label of " leading space" would announce the
                              // problem instead of the choice.
                              aria-label={`${f(p.slide, { n: num(row.slideIndex + 1) })} ${f(
                                p.line,
                                { n: num(row.lineIndex + 1) }
                              )}`}
                              checked={!excluded.has(row.key)}
                              onChange={() => toggleRow(row.key)}
                              disabled={running}
                            />
                          )}
                          <span>
                            {row.kinds.map((kind) => (
                              <span className={`tag ${kind}`} key={kind}>
                                {p.kinds[kind]}
                              </span>
                            ))}{" "}
                            <span className="node-count">
                              {f(p.slide, { n: num(row.slideIndex + 1) })}
                              {row.groupName ? ` · ${row.groupName}` : ""} {"·"}{" "}
                              {f(p.line, { n: num(row.lineIndex + 1) })}
                            </span>
                          </span>
                        </div>

                        {/* Rendered with the whitespace made visible, since the
                            whole point is characters you cannot otherwise see. */}
                        <div className="path whitespace">
                          {row.text === "" ? "—" : visibleWhitespace(row.text)}
                        </div>

                        {row.fix ? (
                          <div className="path whitespace becomes">
                            <span className="becomes-label">{p.becomes}</span>{" "}
                            {row.fix.after === null ? (
                              <em>{p.lineRemoved}</em>
                            ) : row.fix.after === "" ? (
                              "—"
                            ) : (
                              visibleWhitespace(row.fix.after)
                            )}
                          </div>
                        ) : (
                          <div className="why">{p.noFixFor}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * How far a run has got.
 *
 * `role="progressbar"` rather than a native `<progress>`: the vendor
 * pseudo-elements a native one needs before it can be styled for both themes
 * buy nothing these four aria attributes do not already say.
 *
 * The caption names the file as well as the count, because when a run of
 * several hundred reports a refusal afterwards, the useful question is which
 * file it was on at the time.
 */
function ProgressBar({ progress }: { progress: Progress }) {
  const { t, f, num } = useI18n();
  const p = t.tools.presentations;
  const { done, total, path, verb } = progress;
  // Files finished rather than files started, so the bar is never ahead of
  // the work it is reporting.
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const counted = f(p.progressCount, { done: num(done), total: num(total) });

  return (
    <div className="progress-block">
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={counted}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="why progress-caption">
        <span className="progress-file">{f(verb, { n: path })}</span>
        <span className="progress-count">{counted}</span>
      </p>
    </div>
  );
}

/**
 * Show whitespace that is the finding as middle dots, so it can be seen.
 *
 * The edges of a line and any run of two or more inside it -- the three things
 * the checks report. Tabs and non-breaking spaces count: they are exactly as
 * invisible as a plain space and rather more surprising to find.
 */
const GAP = /[ \t\u00a0\u202f\u2007]/;
const EDGES = /^[ \t\u00a0\u202f\u2007]+|[ \t\u00a0\u202f\u2007]+$/g;
const INSIDE = /[ \t\u00a0\u202f\u2007]{2,}/g;

function visibleWhitespace(text: string): string {
  const dots = (run: string) => "\u00b7".repeat(run.length);
  return text.replace(EDGES, dots).replace(INSIDE, dots).replace(GAP, (c) => (c === " " ? c : dots(c)));
}

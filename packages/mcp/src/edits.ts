import { randomUUID } from "node:crypto";
import path from "node:path";
import { createI18n } from "@propresenter-garage/core/i18n/core";
import { isPresentationFile } from "@propresenter-garage/core/lib/folder";
import {
  EditError,
  FixError,
  fixFiles,
  planLineEdits,
  type FixRefusal,
  type LineChange,
  type LineFix,
} from "@propresenter-garage/core/lib/fixes";
import { checkPresentationFidelity } from "@propresenter-garage/core/lib/presentation";
import { LibraryError, readFoundFile, resolveInRoots } from "@propresenter-garage/node/library";
import {
  openBackupDir,
  replaceWithBackup,
  sha256,
  type Replacement,
  type WriteRefusal,
} from "@propresenter-garage/node/write";
import { open, presentationName } from "./tools";

/**
 * Editing slide text, in two calls with a person in between.
 *
 * `planSlideEdits` writes nothing: it works out every change, refuses the lot
 * if any one cannot be made, and keeps the plan under an id. `applySlideEdits`
 * takes that id -- never the edits themselves, so what is applied is exactly
 * what was planned -- and is handed the person's answer by the server, which
 * asks them directly and never the model. See AGENTS.md for the four guards
 * and where each is kept on this surface.
 */

/** Enough lines for a whole song's worth of corrections; a stop for a model asking to rewrite a library at once. */
export const MAX_PLAN_LINES = 200;

/** A plan nobody applied within this long is forgotten: the files have probably moved on. */
const PLAN_TTL_MS = 60 * 60 * 1000;

const MAX_PLANS = 20;

export interface PlannedFile {
  path: string;
  name: string;
  sha256: string;
  /** Each change with its number in the whole plan, which is how the confirmation names it. */
  lines: { n: number; fix: LineFix }[];
}

export interface Plan {
  id: string;
  created: number;
  files: PlannedFile[];
}

/** Plans by id, for this server's lifetime only. */
export class PlanStore {
  private readonly plans = new Map<string, Plan>();

  add(files: PlannedFile[], now = Date.now()): Plan {
    for (const [id, plan] of this.plans) if (now - plan.created > PLAN_TTL_MS) this.plans.delete(id);
    // Oldest first, as a Map iterates.
    while (this.plans.size >= MAX_PLANS) this.plans.delete(this.plans.keys().next().value!);
    const plan = { id: randomUUID(), created: now, files };
    this.plans.set(plan.id, plan);
    return plan;
  }

  /** The plan, removed: one plan is applied, or turned down, once. */
  take(id: string, now = Date.now()): Plan | undefined {
    const plan = this.plans.get(id);
    this.plans.delete(id);
    return plan && now - plan.created <= PLAN_TTL_MS ? plan : undefined;
  }
}

/** One line of a plan, as the model and the person both see it. */
export interface PlannedLine {
  /** Position in the plan, which is how the confirmation names it. */
  n: number;
  slideIndex: number;
  label: string;
  group?: string;
  boxIndex: number;
  lineIndex: number;
  before: string;
  /** Null when the line is removed. */
  after: string | null;
}

export interface PlanResult {
  planId: string;
  files: { path: string; name: string; lines: PlannedLine[] }[];
}

export interface RequestedEdit extends LineChange {
  path: string;
}

/** The app's own sentences for why a file was left alone, so the two surfaces never describe one file differently. */
const { t } = createI18n("en");
const refusals = t.tools.presentations.refusals;

export async function planSlideEdits(
  roots: readonly string[],
  store: PlanStore,
  edits: readonly RequestedEdit[]
): Promise<PlanResult> {
  if (edits.length === 0) throw new LibraryError("No edits given.");
  if (edits.length > MAX_PLAN_LINES) {
    throw new LibraryError(`At most ${MAX_PLAN_LINES} lines in one plan; split the work into smaller plans.`);
  }

  // By the file each edit resolves to, so two spellings of one path are one
  // file, and each file is read once however many of its lines change.
  const resolved = new Map<string, string>();
  const byFile = new Map<string, LineChange[]>();
  for (const { path: p, ...change } of edits) {
    let real = resolved.get(p);
    if (real === undefined) {
      real = await resolveInRoots(roots, p);
      // Only a presentation: a playlist, media bin or theme in the same
      // folders is not something this path was built to write.
      if (!isPresentationFile(path.basename(real))) throw new LibraryError(`Not a presentation (.pro) file: ${p}`);
      resolved.set(p, real);
    }
    const changes = byFile.get(real);
    if (changes) changes.push(change);
    else byFile.set(real, [change]);
  }

  let n = 0;
  const files: PlannedFile[] = [];
  for (const [real, changes] of byFile) {
    const { bytes } = await readFoundFile(real);
    const { doc } = open(real, bytes);
    // Refused now rather than after a person has read and approved every line.
    if (!checkPresentationFidelity(bytes).exportSafe) {
      throw new LibraryError(`${real}: ${refusals.lossy}. Nothing was planned.`);
    }
    let fixes: LineFix[];
    try {
      fixes = planLineEdits(doc, changes);
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      const { boxIndex, lineIndex } = e.change;
      throw new LibraryError(`${real}, box ${boxIndex} line ${lineIndex}: ${t.tools.presentations.editRefusals[e.reason]}. Nothing was planned.`);
    }
    files.push({
      path: real,
      name: doc.name || presentationName(real),
      sha256: sha256(bytes),
      lines: fixes.map((fix) => ({ n: ++n, fix })),
    });
  }

  const plan = store.add(files);
  return {
    planId: plan.id,
    files: plan.files.map((file) => ({
      path: file.path,
      name: file.name,
      lines: file.lines.map(({ fix, n }) => ({
        n,
        slideIndex: fix.slideIndex,
        label: fix.cueName,
        group: fix.groupName,
        boxIndex: fix.boxIndex,
        lineIndex: fix.lineIndex,
        before: fix.before,
        after: fix.after,
      })),
    })),
  };
}

/** A confirmation form: one tick box per line, all ticked, each saying what it changes. */
export function confirmationRequest(plan: Plan, backupDir: string) {
  const properties: Record<string, { type: "boolean"; title: string; description: string; default: boolean }> = {};
  for (const file of plan.files) for (const { fix, n } of file.lines) {
    // Box and line too: a slide can hold the same line twice, and a person
    // choosing one of them has to be able to tell which.
    const where = [
      `slide ${fix.slideIndex + 1}`,
      fix.groupName,
      `text box ${fix.boxIndex + 1}, line ${fix.lineIndex + 1}`,
    ]
      .filter(Boolean)
      .join(", ");
    properties[`line${n}`] = {
      type: "boolean",
      title: `${n}. ${file.name} (${where})`,
      description: `“${fix.before}” → ${fix.after === null ? "line removed" : `“${fix.after}”`}`,
      default: true,
    };
  }
  const count = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return {
    message:
      `Change ${count(plan.files.reduce((sum, f) => sum + f.lines.length, 0), "line")} in ${count(plan.files.length, "presentation")}? ` +
      `Untick any line to leave it as it is. Each file is backed up to ${backupDir} before it is changed. ` +
      "If ProPresenter has one of these open, close it first: ProPresenter may save its own copy over the change.",
    requestedSchema: { type: "object" as const, properties },
  };
}

export type ApplyRefusal = FixRefusal | WriteRefusal;

export interface ApplyResult {
  /** What the person answered. Nothing is written unless they accepted. */
  answer: "accept" | "decline" | "cancel";
  backupFolder?: string;
  files: {
    path: string;
    name: string;
    /** Lines the person left ticked. */
    lines: number;
    written: boolean;
    backup?: string;
    reason?: ApplyRefusal;
    detail?: string;
  }[];
}

/**
 * Apply what the person left ticked.
 *
 * `fixFiles` -- the same run the web app makes -- puts every file through
 * `applyFixes` again from bytes read now: the plan was made from bytes read
 * then, and `applyFixes` is where the fidelity gate and the read-back of every
 * line live. Only files that pass are handed to `replaceWithBackup`, which
 * backs them all up before writing any.
 */
/** The apply in progress, if any; the next waits for it. */
let applying: Promise<unknown> = Promise.resolve();

/**
 * Apply what the person left ticked, one plan at a time.
 *
 * Two plans for the same song, confirmed at once, would otherwise both read
 * the same original and both pass the check before either renamed: the
 * second would land over the first, and both would report success. In
 * series, the second finds the file changed and is refused as stale.
 */
export function applyPlan(
  roots: readonly string[],
  plan: Plan,
  ticked: ReadonlySet<number>,
  backupDir: string,
  signal?: AbortSignal
): Promise<Omit<ApplyResult, "answer">> {
  const run = applying.then(() => applyPlanNow(roots, plan, ticked, backupDir, signal));
  applying = run.catch(() => undefined);
  return run;
}

/** The client gave up on the call; nothing may be written behind its back. */
function stopIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LibraryError("The call was cancelled before anything was written, so nothing was.");
}

async function applyPlanNow(
  roots: readonly string[],
  plan: Plan,
  ticked: ReadonlySet<number>,
  backupDir: string,
  signal?: AbortSignal
): Promise<Omit<ApplyResult, "answer">> {
  // Checked when this run's turn comes, not only when it joined the queue: a
  // client can give up while an earlier apply is still writing.
  stopIfCancelled(signal);
  const planned = new Map(plan.files.map((file) => [file.path, file]));
  const originals = new Map<string, Uint8Array>();
  const fixed = await fixFiles(
    plan.files.map((file) => ({
      path: file.path,
      fixes: file.lines.filter(({ n }) => ticked.has(n)).map(({ fix }) => fix),
    })),
    {
      read: async (p) => {
        const { bytes } = await readFoundFile(p);
        if (sha256(bytes) !== planned.get(p)!.sha256) throw new FixError("stale");
        originals.set(p, bytes);
        return bytes;
      },
    }
  );

  const files: ApplyResult["files"] = fixed.map(({ path: p, lines, reason }) => ({
    path: p,
    name: planned.get(p)!.name,
    lines,
    written: false,
    reason,
  }));
  const replacements: Replacement[] = fixed
    .filter((outcome) => outcome.bytes)
    .map(({ path: p, bytes }) => ({ path: p, original: originals.get(p)!, updated: bytes! }));

  let backupFolder: string | undefined;
  if (replacements.length > 0) {
    // And once more at the last moment before anything on disk changes.
    stopIfCancelled(signal);
    const run = await replaceWithBackup(roots, await openBackupDir(backupDir, roots), replacements);
    backupFolder = run.backupFolder;
    const byPath = new Map(run.outcomes.map((outcome) => [outcome.path, outcome]));
    for (const file of files) Object.assign(file, byPath.get(file.path));
  }

  return {
    backupFolder,
    files: files.map((file) =>
      file.reason ? { ...file, detail: [refusals[file.reason], file.detail].filter(Boolean).join(": ") } : file
    ),
  };
}

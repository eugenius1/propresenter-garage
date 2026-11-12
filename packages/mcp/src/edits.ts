import { randomUUID } from "node:crypto";
import {
  applyFixes,
  EditError,
  FixError,
  planLineEdits,
  type EditRefusal,
  type FixRefusal,
  type LineChange,
  type LineFix,
} from "@propresenter-garage/core/lib/fixes";
import { checkPresentationFidelity } from "@propresenter-garage/core/lib/presentation";
import { LibraryError, readLibraryFile } from "@propresenter-garage/node/library";
import { openBackupDir, replaceWithBackup, sha256, type WriteRefusal } from "@propresenter-garage/node/write";
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
  fixes: LineFix[];
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

const EDIT_REFUSALS: Record<EditRefusal, string> = {
  noSuchLine: "there is no such text box or line; read_presentation gives the addresses",
  duplicate: "two edits name the same line",
  unchanged: "the line already reads that",
  unsupported:
    "that cannot be written on one line: a line break or control character, or removing the last line of a box",
};

/** The lines of a plan in order, numbered as the confirmation numbers them. */
function numbered(plan: Plan): { file: PlannedFile; fix: LineFix; n: number }[] {
  let n = 0;
  return plan.files.flatMap((file) => file.fixes.map((fix) => ({ file, fix, n: ++n })));
}

export async function planSlideEdits(
  roots: readonly string[],
  store: PlanStore,
  edits: readonly RequestedEdit[]
): Promise<PlanResult> {
  if (edits.length === 0) throw new LibraryError("No edits given.");
  if (edits.length > MAX_PLAN_LINES) {
    throw new LibraryError(`At most ${MAX_PLAN_LINES} lines in one plan; split the work into smaller plans.`);
  }

  // By the file each edit resolves to, so two spellings of one path are one file.
  const byFile = new Map<string, { bytes: Uint8Array; changes: LineChange[] }>();
  for (const { path: p, ...change } of edits) {
    const { path: real, bytes } = await readLibraryFile(roots, p);
    const entry = byFile.get(real) ?? { bytes, changes: [] };
    entry.changes.push(change);
    byFile.set(real, entry);
  }

  const files: PlannedFile[] = [];
  for (const [real, { bytes, changes }] of byFile) {
    const { doc } = open(real, bytes);
    // Refused now rather than after a person has read and approved every line.
    if (!checkPresentationFidelity(bytes).exportSafe) {
      throw new LibraryError(
        `${real}: this file uses something the schema does not cover, so writing it could lose data. Nothing was planned.`
      );
    }
    try {
      files.push({ path: real, name: doc.name || presentationName(real), sha256: sha256(bytes), fixes: planLineEdits(doc, changes) });
    } catch (e) {
      if (!(e instanceof EditError)) throw e;
      const { boxIndex, lineIndex } = e.change;
      throw new LibraryError(
        `${real}, box ${boxIndex} line ${lineIndex}: ${EDIT_REFUSALS[e.reason]}. Nothing was planned.`
      );
    }
  }

  const plan = store.add(files);
  const lines = numbered(plan);
  return {
    planId: plan.id,
    files: plan.files.map((file) => ({
      path: file.path,
      name: file.name,
      lines: lines
        .filter((l) => l.file === file)
        .map(({ fix, n }) => ({
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
  const lines = numbered(plan);
  const properties: Record<string, { type: "boolean"; title: string; description: string; default: boolean }> = {};
  for (const { file, fix, n } of lines) {
    const where = [`slide ${fix.slideIndex + 1}`, fix.groupName].filter(Boolean).join(", ");
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
      `Change ${count(lines.length, "line")} in ${count(plan.files.length, "presentation")}? ` +
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

const APPLY_NOTE: Record<ApplyRefusal, string> = {
  lossy: "this file uses something the schema does not cover, so saving it could lose data",
  unreadable: "this file could not be read",
  unchanged: "every line in this file was unticked",
  verifyFailed: "the result did not read back as promised, so it was not saved",
  stale: "this file changed since the plan was made, so the plan no longer fits it",
  changed: "this file changed since the plan was made, so the plan no longer fits it",
  moved: "this file is no longer where it was, or is now reached through a symlink",
  backupFailed: "a backup could not be made and checked, so nothing was written",
  writeFailed: "the folder would not accept the file; the original is untouched",
  readBackFailed: "the file on disk does not hold what was written; restore it from the backup",
};

/**
 * Apply what the person left ticked.
 *
 * Every file goes through `applyFixes` again from bytes read now: the plan
 * was made from bytes read then, and `applyFixes` is where the fidelity gate
 * and the read-back of every line live. Only files that pass are handed to
 * `replaceWithBackup`, which backs them all up before writing any.
 */
export async function applyPlan(
  roots: readonly string[],
  plan: Plan,
  ticked: ReadonlySet<number>,
  backupDir: string
): Promise<Omit<ApplyResult, "answer">> {
  const lines = numbered(plan);
  const results: ApplyResult["files"] = [];
  const replacements = [];

  for (const file of plan.files) {
    const fixes = lines.filter((l) => l.file === file && ticked.has(l.n)).map((l) => l.fix);
    const result: ApplyResult["files"][number] = { path: file.path, name: file.name, lines: fixes.length, written: false };
    results.push(result);
    try {
      const { bytes } = await readLibraryFile(roots, file.path);
      if (sha256(bytes) !== file.sha256) throw new FixError("stale");
      replacements.push({ path: file.path, originalSha256: file.sha256, updated: applyFixes(bytes, fixes) });
    } catch (e) {
      result.reason = e instanceof FixError ? e.reason : "unreadable";
      if (!(e instanceof FixError)) result.detail = (e as Error).message;
    }
  }

  if (replacements.length === 0) return { files: results.map(withNote) };

  const { backupFolder, outcomes } = await replaceWithBackup(roots, await openBackupDir(backupDir, roots), replacements);
  for (const outcome of outcomes) {
    Object.assign(results.find((r) => r.path === outcome.path)!, {
      written: outcome.written,
      backup: outcome.backup,
      reason: outcome.reason,
      detail: outcome.detail,
    });
  }
  return { backupFolder, files: results.map(withNote) };
}

function withNote(file: ApplyResult["files"][number]): ApplyResult["files"][number] {
  if (!file.reason) return file;
  return { ...file, detail: [APPLY_NOTE[file.reason], file.detail].filter(Boolean).join(": ") };
}

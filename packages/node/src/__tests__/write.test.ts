import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRoots } from "../library";
import { openBackupDir, replaceWithBackup, type Replacement } from "../write";

/**
 * The disk half of the write path, against real files in a temporary folder:
 * a backup of every file before any is replaced, a file that changed since it
 * was planned left alone, and nothing half-written left behind.
 */

let tmp: string;
let library: string;
let backups: string;
let roots: string[];

const bytes = (s: string) => new TextEncoder().encode(s);

function song(name: string, content: string): string {
  const file = path.join(library, "Libraries", "Default", name);
  fs.writeFileSync(file, content);
  return file;
}

function replacement(file: string, updated: string): Replacement {
  return { path: file, original: new Uint8Array(fs.readFileSync(file)), updated: bytes(updated) };
}

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pp-write-")));
  library = path.join(tmp, "ProPresenter");
  fs.mkdirSync(path.join(library, "Libraries", "Default"), { recursive: true });
  backups = path.join(tmp, "Backups");
  roots = await openRoots([library]);
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("replaceWithBackup", () => {
  it("backs up the original where a restore is a copy back, then replaces it", async () => {
    const file = song("Amazing Grace.pro", "before");
    const run = await replaceWithBackup(roots, await openBackupDir(backups, roots), [replacement(file, "after")]);

    expect(run.outcomes).toEqual([{ path: file, written: true, backup: expect.any(String) }]);
    expect(fs.readFileSync(file, "utf8")).toBe("after");
    const backup = run.outcomes[0].backup!;
    expect(fs.readFileSync(backup, "utf8")).toBe("before");
    expect(path.relative(run.backupFolder!, backup)).toBe(path.join("ProPresenter", "Libraries", "Default", "Amazing Grace.pro"));
  });

  it("keeps apart two library folders that share a name", async () => {
    const other = path.join(tmp, "Elsewhere", "ProPresenter");
    fs.mkdirSync(path.join(other, "Libraries", "Default"), { recursive: true });
    const both = await openRoots([library, other]);
    const a = song("Song.pro", "a");
    const b = path.join(other, "Libraries", "Default", "Song.pro");
    fs.writeFileSync(b, "b");

    const run = await replaceWithBackup(both, await openBackupDir(backups, both), [
      replacement(a, "a2"),
      replacement(b, "b2"),
    ]);
    expect(run.outcomes.map((o) => o.written)).toEqual([true, true]);
    expect(run.outcomes.map((o) => fs.readFileSync(o.backup!, "utf8"))).toEqual(["a", "b"]);
  });

  it("keeps backups private, and the replacement's mode as the original's", async () => {
    if (process.platform === "win32") return;
    const file = song("Shared.pro", "before");
    fs.chmodSync(file, 0o664);
    const run = await replaceWithBackup(roots, await openBackupDir(backups, roots), [replacement(file, "after")]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o664);
    expect(fs.statSync(run.outcomes[0].backup!).mode & 0o777).toBe(0o600);
    expect(fs.statSync(run.backupFolder!).mode & 0o777).toBe(0o700);
  });

  it("leaves no temporary file beside the original", async () => {
    const file = song("Song.pro", "before");
    await replaceWithBackup(roots, await openBackupDir(backups, roots), [replacement(file, "after")]);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["Song.pro"]);
  });

  it("leaves alone a file that changed since it was planned", async () => {
    const file = song("Song.pro", "before");
    const planned = replacement(file, "after");
    fs.writeFileSync(file, "ProPresenter saved this meanwhile");

    const run = await replaceWithBackup(roots, await openBackupDir(backups, roots), [planned]);
    expect(run.outcomes[0]).toMatchObject({ written: false, reason: "stale" });
    expect(fs.readFileSync(file, "utf8")).toBe("ProPresenter saved this meanwhile");
  });

  it("writes nothing at all when one backup cannot be made", async () => {
    const a = song("A.pro", "a");
    const b = song("B.pro", "b");
    const dir = await openBackupDir(backups, roots);
    // The backup folder replaced by a file, so nothing can be made in it.
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(dir, "");

    const run = await replaceWithBackup(roots, dir, [replacement(a, "A2"), replacement(b, "B2")]);
    expect(run.outcomes.map((o) => o.reason)).toEqual(["backupFailed", "backupFailed"]);
    expect(fs.readFileSync(a, "utf8")).toBe("a");
    expect(fs.readFileSync(b, "utf8")).toBe("b");
  });

  it("gives each run its own folder, even within the same second", async () => {
    const file = song("Song.pro", "one");
    const dir = await openBackupDir(backups, roots);
    const now = new Date("2026-01-02T03:04:05Z");
    const first = await replaceWithBackup(roots, dir, [replacement(file, "two")], now);
    const second = await replaceWithBackup(roots, dir, [replacement(file, "three")], now);
    expect(first.backupFolder).not.toBe(second.backupFolder);
    expect(fs.readFileSync(first.outcomes[0].backup!, "utf8")).toBe("one");
    expect(fs.readFileSync(second.outcomes[0].backup!, "utf8")).toBe("two");
  });

  it("refuses a file that has become a symlink", async () => {
    if (process.platform === "win32") return;
    const file = song("Song.pro", "before");
    const planned = replacement(file, "after");
    const elsewhere = path.join(tmp, "elsewhere.pro");
    fs.writeFileSync(elsewhere, "before");
    fs.rmSync(file);
    fs.symlinkSync(elsewhere, file);

    const run = await replaceWithBackup(roots, await openBackupDir(backups, roots), [planned]);
    expect(run.outcomes[0]).toMatchObject({ written: false, reason: "moved" });
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("before");
  });
});

describe("openBackupDir", () => {
  it("creates the folder", async () => {
    expect(await openBackupDir(backups, roots)).toBe(backups);
    expect(fs.statSync(backups).isDirectory()).toBe(true);
  });

  it("refuses a folder inside a library, where backups would show up as songs", async () => {
    await expect(openBackupDir(path.join(library, "Backups"), roots)).rejects.toThrow(/inside a library folder/);
    // Refused before it was made, so nothing is left behind in the library.
    expect(fs.existsSync(path.join(library, "Backups"))).toBe(false);
  });
});

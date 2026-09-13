// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Remembering what was loaded, across a refresh.
 *
 * IndexedDB rather than localStorage, for two reasons. It stores structured
 * clones, so a `FileSystemDirectoryHandle` survives as a live handle rather
 * than a useless description of one -- that is the only way a folder can be
 * reopened without asking again. And it holds megabytes, where localStorage
 * holds a few and only strings.
 *
 * What is kept is genuinely the reader's own media library, so it is kept on
 * their machine, in their browser, scoped to this origin, and every tool that
 * uses it offers a way to forget it.
 */

const DATABASE = "propresenter-garage";
const STORE = "session";
const VERSION = 1;

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open the database"));
  });

  // A failed connection must not be cached, or every later call fails too.
  connection.catch(() => {
    connection = null;
  });

  return connection;
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error("the request failed"));
      })
  );
}

/**
 * Read a remembered value.
 *
 * Never throws: storage can be unavailable in a private window, disabled by
 * policy, or simply empty, and none of those should stop the app loading.
 */
export async function remember<T>(key: string): Promise<T | null> {
  try {
    return ((await transact<T | undefined>("readonly", (store) => store.get(key))) ?? null);
  } catch {
    return null;
  }
}

/** Keep a value. Returns whether it was actually kept. */
export async function keep(key: string, value: unknown): Promise<boolean> {
  try {
    await transact("readwrite", (store) => store.put(value, key));
    return true;
  } catch {
    return false;
  }
}

/** Forget one value. */
export async function forget(key: string): Promise<void> {
  try {
    await transact("readwrite", (store) => store.delete(key));
  } catch {
    /* nothing to do: it is already not there */
  }
}

/** Forget everything this app has kept. */
export async function forgetAll(): Promise<void> {
  try {
    await transact("readwrite", (store) => store.clear());
  } catch {
    /* as above */
  }
}

export const KEYS = {
  mediaBinBaseline: "mediaBin.baseline",
  mediaBinCompare: "mediaBin.compare",
  presentationsFolder: "presentations.folder",
  presentationsChecks: "presentations.checks",
} as const;

/** A loaded file, small enough to keep whole. */
export interface RememberedFile {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Whether a stored directory handle may still be used.
 *
 * Permission does not necessarily survive a refresh: in an ordinary tab it
 * lapses once the last tab for the origin closes, while an installed app keeps
 * it. Asking again needs a user gesture, so a caller that gets "prompt" has to
 * offer a button rather than re-requesting on load.
 */
export async function handlePermission(
  handle: unknown,
  mode: "read" | "readwrite" = "read"
): Promise<PermissionState> {
  const queryable = handle as { queryPermission?: (o: { mode: string }) => Promise<PermissionState> };
  if (typeof queryable?.queryPermission !== "function") return "prompt";
  try {
    return await queryable.queryPermission({ mode });
  } catch {
    return "denied";
  }
}

/** Ask again for a stored handle. Must be called from a user gesture. */
export async function requestHandlePermission(
  handle: unknown,
  mode: "read" | "readwrite" = "read"
): Promise<PermissionState> {
  const requestable = handle as {
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  if (typeof requestable?.requestPermission !== "function") return "denied";
  try {
    return await requestable.requestPermission({ mode });
  } catch {
    return "denied";
  }
}

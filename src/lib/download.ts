// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Handing a file to the reader.
 *
 * One implementation, because both of the awkward parts are easy to get wrong
 * and were each discovered the hard way:
 *
 * - An anchor that is not in the document is ignored by some browsers, so it
 *   is appended before the click rather than merely created.
 * - Revoking the object URL in the same task as the click can pull the blob
 *   away before the browser has finished reading it. Safari is the usual
 *   casualty, and the failure is a download that silently produces nothing.
 */

/** Offer bytes to the reader as a file, and return the name it was given. */
export function download(
  name: string,
  bytes: Uint8Array,
  type = "application/octet-stream"
): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Let the current task finish before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return name;
}

/**
 * A timestamp for a filename: `20260914-1420`.
 *
 * Local time rather than UTC, because the reader matches it against when they
 * remember doing the thing, not against a clock in Greenwich.
 */
export function stamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

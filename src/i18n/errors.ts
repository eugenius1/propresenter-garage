// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { DecodeError } from "../lib/decode";
import type { I18n } from "./core";

/**
 * Turn a thrown error into a sentence in the reader's language.
 *
 * `hint` is supplied by the tool, which is the only thing that knows which file
 * it wanted; the shared error only knows which kind it got.
 */
export function errorMessage(i18n: I18n, error: unknown, hint?: string): string {
  const { t, f } = i18n;
  if (error instanceof DecodeError) {
    switch (error.code) {
      case "empty":
        return t.errors.empty;
      case "notProtobuf":
        return f(t.errors.notProtobuf, { reason: error.params.reason ?? "" });
      case "wrongPlaylistType": {
        const kinds = t.errors.playlistType;
        const actual = (error.params.actual ?? "unknown") as keyof typeof kinds;
        const expected = (error.params.expected ?? "unknown") as keyof typeof kinds;
        const message = f(t.errors.wrongPlaylistType, {
          actual: kinds[actual],
          expected: kinds[expected],
        });
        return hint ? `${message} ${hint}` : message;
      }
    }
  }
  return (error as Error).message;
}

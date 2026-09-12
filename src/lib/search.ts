// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Folding text so a search matches what someone actually types.
 *
 * A media library named in French is full of accents, and nobody reaches for
 * the accented key to find something: "cene" should find "Sainte Cène". Plain
 * `toLowerCase` does not, because é and e are different characters however
 * alike they look.
 *
 * Decomposing to NFD separates a letter from the marks applied to it, so
 * stripping the marks leaves the bare letter behind. That covers every accent
 * French, Spanish, Portuguese and German use.
 *
 * It does not cover letters that are not a base plus a mark -- ø, ł, đ have no
 * decomposition, and æ, œ, ß stand for two letters rather than an accented
 * one. Those are listed, since "coeur" failing to find "Cœur" is the same
 * surprise from the reader's side.
 *
 * Folding is for searching only. Nothing written back to a file passes through
 * here: names are stored exactly as ProPresenter wrote them.
 */

const STANDS_FOR: Record<string, string> = {
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
};

export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[æœßøłđðþ]/g, (letter) => STANDS_FOR[letter])
    .normalize("NFD")
    // Nonspacing marks: what NFD just separated out, and nothing else.
    .replace(/\p{Mn}/gu, "");
}

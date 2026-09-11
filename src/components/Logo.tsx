// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * The app mark: two columns of bars, reading as one list set against another.
 *
 * Inline rather than an <img> so it inherits colour and stays crisp, and so it
 * cannot flash in late on a slow connection. Deliberately the same shape as the
 * favicon and the installed-app icons.
 */
export function Logo() {
  return (
    <svg
      className="logo"
      viewBox="0 0 64 64"
      width="26"
      height="26"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <g fill="#fff">
        <rect x="14" y="16" width="16" height="6" rx="3" />
        <rect x="14" y="29" width="16" height="6" rx="3" opacity=".75" />
        <rect x="14" y="42" width="16" height="6" rx="3" opacity=".5" />
        <rect x="36" y="16" width="16" height="6" rx="3" opacity=".5" />
        <rect x="36" y="29" width="16" height="6" rx="3" />
        <rect x="36" y="42" width="16" height="6" rx="3" opacity=".75" />
      </g>
    </svg>
  );
}

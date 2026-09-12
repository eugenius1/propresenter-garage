// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

/**
 * Paths for tools, on a host that serves only static files.
 *
 * GitHub Pages has no rewrite rules, so a deep link like /presentations would
 * normally 404 on refresh. The build writes a copy of index.html as 404.html,
 * which Pages serves for any unmatched path; the app then reads the path and
 * shows the right tool. That is why routing here works off `location.pathname`
 * rather than a hash.
 *
 * The base is derived from where the document was served rather than hardcoded,
 * so the same build runs at the domain root, under /propresenter-garage/, or
 * from a dev server, without configuration.
 */

export interface Route {
  /** The URL segment, e.g. "presentations". */
  slug: string;
}

/**
 * The part of the path that is not a tool slug.
 *
 * Derived by removing a trailing slug if the last segment matches one of the
 * known tools; whatever is left is where the app is mounted.
 */
export function basePath(pathname: string, slugs: readonly string[]): string {
  const trimmed = pathname.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  const last = trimmed.slice(lastSlash + 1);
  if (slugs.includes(last)) return trimmed.slice(0, lastSlash + 1) || "/";
  return trimmed ? `${trimmed}/` : "/";
}

/** Which tool a path names, or null for the app root. */
export function slugFromPath(pathname: string, slugs: readonly string[]): string | null {
  const trimmed = pathname.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return slugs.includes(last) ? last : null;
}

/**
 * The URL a tool should live at.
 *
 * The first tool is the home page and has no segment of its own, so the root
 * URL is never a redirect to somewhere else.
 */
export function pathForSlug(base: string, slug: string, slugs: readonly string[]): string {
  return slug === slugs[0] ? base : `${base}${slug}`;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { afterEach } from "vitest";

/**
 * Shared test setup.
 *
 * Only touches the DOM when a test file has opted into jsdom, so the node-only
 * analysis suites are unaffected.
 */
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  afterEach(() => {
    cleanup();
    // Each test starts from a clean slate: the language and theme controls both
    // persist, and a leaked value would make results depend on test order.
    try {
      localStorage.clear();
    } catch {
      /* storage may be unavailable */
    }
    document.documentElement.className = "";
  });
}

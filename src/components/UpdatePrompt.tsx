// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useI18n } from "../i18n";

/**
 * Offer a reload when a newer build has been deployed.
 *
 * The service worker serves from its cache first, so without this the first
 * visit after a deploy renders the *previous* build and only the visit after
 * that picks up the new one. That is invisible and maddening: the app looks
 * unchanged, and reloading once does not help either.
 *
 * So registration asks rather than swapping silently. Swapping without asking
 * would be worse than the stale copy -- a reader halfway through reviewing a
 * diff would have the page replaced underneath them.
 */

export type UpdateSW = (reload?: boolean) => Promise<void>;

export interface Registrar {
  (options: {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
  }): UpdateSW;
}

/**
 * How often a tab that is left open asks whether a newer build exists.
 *
 * A service worker only checks on navigation otherwise, so a tab open all
 * week would never notice.
 */
const CHECK_EVERY = 60 * 60 * 1000;

/** The real registration, loaded lazily so tests never need the virtual module. */
async function loadRegistrar(): Promise<Registrar | null> {
  try {
    const module = await import("virtual:pwa-register");
    return module.registerSW as Registrar;
  } catch {
    // No service worker in this build, which is the case in development.
    return null;
  }
}

export function UpdatePrompt({ load = loadRegistrar }: { load?: () => Promise<Registrar | null> }) {
  const { t } = useI18n();
  const [update, setUpdate] = useState<UpdateSW | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      const registerSW = await load();
      if (!registerSW || cancelled) return;

      const updateSW = registerSW({
        onNeedRefresh: () => {
          if (!cancelled) setUpdate(() => updateSW);
        },
        onRegisteredSW: (_url, registration) => {
          if (!registration || cancelled) return;
          timer = setInterval(() => void registration.update(), CHECK_EVERY);
        },
      });
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [load]);

  if (!update) return null;

  return (
    <div className="update-bar" role="status">
      <RefreshCw size={15} aria-hidden="true" />
      <span className="update-text">{t.app.updateReady}</span>
      <button
        className="btn primary"
        disabled={reloading}
        // `true` reloads the page once the waiting worker has taken over,
        // which is what actually shows the new build.
        onClick={() => {
          setReloading(true);
          void update(true);
        }}
      >
        {reloading ? t.app.updating : t.app.updateNow}
      </button>
      <button className="btn icon" aria-label={t.app.updateLater} title={t.app.updateLater} onClick={() => setUpdate(null)}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useRef, useState } from "react";
import type { Fidelity } from "../lib/decode";
import { formatBytes, loadMediaFile, type LoadedFile } from "../lib/loadFile";
import { useI18n, type I18n } from "../i18n";
import { errorMessage } from "../i18n/errors";

interface Props {
  role: string;
  hint: string;
  /** Extra guidance shown when the file is the wrong kind of playlist. */
  wrongKindHint?: string;
  file: LoadedFile | null;
  onLoad: (file: LoadedFile) => void;
  onClear: () => void;
}

function fidelityLabel({ t }: I18n, fidelity: Fidelity): string {
  return t.fidelity[fidelity];
}

function fidelityHelp({ t }: I18n, fidelity: Fidelity): string {
  return {
    identical: t.fidelity.identicalHelp,
    equivalent: t.fidelity.equivalentHelp,
    lossy: t.fidelity.lossyHelp,
  }[fidelity];
}

export function FileSlot({ role, hint, wrongKindHint, file, onLoad, onClear }: Props) {
  const i18n = useI18n();
  const { t, plural, f } = i18n;
  const input = useRef<HTMLInputElement>(null);
  // Store the error, not a rendered sentence. Keeping the formatted string here
  // meant a message stayed in whichever language was active when the file was
  // rejected, because switching language left nothing to re-render from.
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);

  async function accept(picked: File | undefined) {
    setDragging(false);
    if (!picked) return;
    setError(null);
    try {
      onLoad(await loadMediaFile(picked));
    } catch (e) {
      setError(e);
    }
  }

  if (!file) {
    return (
      <div
        className={`slot empty${dragging ? " drag" : ""}${error ? " error" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); void accept(e.dataTransfer.files[0]); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      >
        <input ref={input} type="file" hidden onChange={(e) => void accept(e.target.files?.[0])} />
        <div className="slot-role">{role}</div>
        <div style={{ marginTop: 4 }}>
          {error ? (
            <span style={{ color: "var(--removed)" }}>
              {errorMessage(i18n, error, wrongKindHint)}
            </span>
          ) : (
            hint
          )}
        </div>
      </div>
    );
  }

  const { library: lib } = file;
  return (
    <div className="slot">
      <div className="slot-role">{role}</div>
      <div className="slot-name">
        {file.filename}
        <span
          className={`chip ${file.exportSafe ? "ok" : "bad"}`}
          title={fidelityHelp(i18n, file.fidelity)}
        >
          {fidelityLabel(i18n, file.fidelity)}
        </span>
      </div>
      <div className="slot-meta">
        <span>{plural(t.tools.mediaBin.items, lib.items.length)}</span>
        <span>{plural(t.tools.mediaBin.playlists, lib.playlists.length)}</span>
        <span>{formatBytes(file.bytes, i18n)}</span>
        <span>{f(t.tools.mediaBin.appOn, { version: lib.appVersion, platform: lib.platform })}</span>
      </div>
      <div className="slot-actions">
        <button className="btn" onClick={onClear}>{t.tools.mediaBin.replace}</button>
      </div>
    </div>
  );
}

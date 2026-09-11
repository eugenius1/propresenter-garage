// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { useRef, useState } from "react";
import { DecodeError, type Fidelity } from "../lib/decode";
import { formatBytes, loadMediaFile, type LoadedFile } from "../lib/loadFile";
import { useI18n, type I18n } from "../i18n";

interface Props {
  role: string;
  hint: string;
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

/** Turn a thrown error into a sentence in the reader's language. */
function errorMessage(i18n: I18n, error: unknown): string {
  const { t, f } = i18n;
  if (error instanceof DecodeError) {
    switch (error.code) {
      case "empty":
        return t.errors.empty;
      case "notProtobuf":
        return f(t.errors.notProtobuf, { reason: error.params.reason ?? "" });
      case "wrongPlaylistType": {
        const key = (error.params.type ?? "unknown") as keyof typeof t.errors.playlistType;
        return f(t.errors.wrongPlaylistType, { type: t.errors.playlistType[key] });
      }
    }
  }
  return (error as Error).message;
}

export function FileSlot({ role, hint, file, onLoad, onClear }: Props) {
  const i18n = useI18n();
  const { t, plural, f } = i18n;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function accept(picked: File | undefined) {
    setDragging(false);
    if (!picked) return;
    setError(null);
    try {
      onLoad(await loadMediaFile(picked));
    } catch (e) {
      setError(errorMessage(i18n, e));
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
          {error ? <span style={{ color: "var(--removed)" }}>{error}</span> : hint}
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
        <span>{plural(t.slots.items, lib.items.length)}</span>
        <span>{plural(t.slots.playlists, lib.playlists.length)}</span>
        <span>{formatBytes(file.bytes, i18n)}</span>
        <span>{f(t.slots.appOn, { version: lib.appVersion, platform: lib.platform })}</span>
      </div>
      <div className="slot-actions">
        <button className="btn" onClick={onClear}>{t.slots.replace}</button>
      </div>
    </div>
  );
}

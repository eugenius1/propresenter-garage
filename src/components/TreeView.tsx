import { useState } from "react";
import type { MediaLibrary, PlaylistNode } from "../lib/model";
import { useI18n, type I18n } from "../i18n";

function Node({ node, depth, i18n }: { node: PlaylistNode; depth: number; i18n: I18n }) {
  const { t, f, plural } = i18n;
  const hasChildren = node.children.length > 0;
  const count = node.items.length;

  return (
    <li>
      <details open={depth < 1}>
        <summary>
          <span className="node-name">{node.name || t.browse.unnamed}</span>
          <span className="node-count">
            {count > 0 && plural(t.browse.itemCount, count)}
            {count > 0 && hasChildren && " · "}
            {hasChildren && f(t.browse.subCount, { n: node.children.length })}
            {count === 0 && !hasChildren && t.browse.empty}
          </span>
        </summary>
        <ul>
          {node.items.map((item) => (
            <li className="leaf" key={item.uuid || `${item.key}-${item.index}`}>
              <span className="item-name">{item.name || item.displayFilename}</span>
              <span className="item-path">{item.relativePath || item.absolutePath}</span>
            </li>
          ))}
          {node.children.map((child) => (
            <Node key={child.uuid || child.path} node={child} depth={depth + 1} i18n={i18n} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function TreeView({ lib }: { lib: MediaLibrary }) {
  const i18n = useI18n();
  const { t, f, plural } = i18n;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = q
    ? lib.items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.displayFilename.toLowerCase().includes(q) ||
          i.playlistPath.toLowerCase().includes(q)
      )
    : [];

  return (
    <div className="card">
      <h2>{t.browse.heading}</h2>
      <p className="sub">
        {f(t.browse.subtitle, {
          items: plural(t.browse.items, lib.items.length),
          playlists: plural(t.browse.playlists, lib.playlists.length),
        })}
      </p>

      <input
        type="search"
        placeholder={t.browse.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          font: "inherit", width: "100%", padding: "7px 10px", marginBottom: 12,
          borderRadius: 7, border: "1px solid var(--border-strong)",
          background: "var(--surface-2)", color: "var(--text)",
        }}
      />

      {q ? (
        <>
          <p className="sub">{plural(t.browse.matches, matches.length)}</p>
          <ul className="rows">
            {matches.slice(0, 200).map((item) => (
              <li key={item.uuid || `${item.key}-${item.index}`}>
                <div>
                  {item.name || item.displayFilename}
                  <span className="kind">{t.kinds[item.kind]}</span>
                </div>
                <div className="path">{item.playlistPath} — {item.relativePath}</div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="tree">
          {lib.root.children.map((child) => (
            <Node key={child.uuid || child.path} node={child} depth={0} i18n={i18n} />
          ))}
        </ul>
      )}
    </div>
  );
}

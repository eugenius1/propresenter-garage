// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

// Copy index.html to 404.html after building.
//
// GitHub Pages serves only static files and has no rewrite rules, so a deep
// link such as /propresenter-garage/media-bin has no file behind it and would
// 404 on refresh or when shared. Pages serves 404.html for any unmatched path,
// so a copy of the app there makes deep links work: the app reads the path and
// shows the right tool.
//
// Asset URLs are relative (`base: "./"`), and every tool path is one segment
// deep, so `./assets/...` resolves identically from either entry point.
import fs from "node:fs";
import path from "node:path";

const dist = "dist";
const index = path.join(dist, "index.html");

if (!fs.existsSync(index)) {
  console.error(`spa-fallback: no ${index} -- run the build first`);
  process.exit(1);
}

fs.copyFileSync(index, path.join(dist, "404.html"));
console.log("spa-fallback -> dist/404.html");

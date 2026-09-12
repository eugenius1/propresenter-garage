// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      // "prompt", not "autoUpdate": a cache-first worker serves the previous
      // build on the first visit after a deploy, and swapping it silently
      // would replace the page under whoever is reading it. UpdatePrompt asks.
      registerType: "prompt",
      // Registration happens in UpdatePrompt, which needs the callbacks.
      injectRegister: null,
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "ProPresenter Garage",
        short_name: "PP Garage",
        description:
          "A suite of utilities for ProPresenter 7 files. Runs entirely in your browser.",
        theme_color: "#3b6ef5",
        background_color: "#f6f7f9",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The schema descriptor is part of the bundle, so a cached install is
        // fully functional with no network at all.
        globPatterns: ["**/*.{js,css,html,svg,png,json}"],
      },
    }),
  ],
  test: {
    // Node by default: the analysis suites are the bulk of the tests and need
    // no DOM. Component tests opt in with a `@vitest-environment jsdom`
    // docblock, which keeps the fast path fast.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup.ts"],
  },
});

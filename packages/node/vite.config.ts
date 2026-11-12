import { defineConfig } from "vite";

/** Only the tests: like core, this is never built on its own, only bundled into what uses it. */
export default defineConfig({ test: { name: "node" } });

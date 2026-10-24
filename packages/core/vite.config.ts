import { defineConfig } from "vite";

/** Only the tests: core is never built on its own, only as part of web. */
export default defineConfig({ test: { name: "core" } });

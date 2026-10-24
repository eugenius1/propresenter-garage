import { defineConfig } from "vite";

/** Only the tests: core is never built on its own, only as part of web and mcp. */
export default defineConfig({
  test: {
    name: "core",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

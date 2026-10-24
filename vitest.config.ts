import { defineConfig } from "vitest/config";

/**
 * One run over every package, each with its own environment and setup.
 *
 * Coverage is measured here rather than per package, so CI uploads a single
 * report covering all three to Codecov.
 */
export default defineConfig({
  test: {
    projects: ["packages/*"],
    // Only CI measures coverage, for the Codecov upload; locally it would slow
    // every `npm test` for a number nobody reads. `npm run coverage` forces it.
    coverage: {
      enabled: !!process.env.CI,
      include: ["packages/*/src/**"],
      exclude: [
        "packages/*/src/**/__tests__/**",
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/core/src/generated/**",
        // Only starts the MCP server on stdio; the suite drives the server
        // itself in-process, and a child process would not be measured.
        "packages/mcp/src/main.ts",
      ],
      reporter: ["lcov", "text-summary"],
    },
  },
});

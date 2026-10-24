import { defineConfig } from "vite";

/**
 * The MCP server, bundled into one file Node can run with nothing installed.
 *
 * Everything is inlined -- the schema descriptor, protobuf.js, the MCP SDK --
 * so an MCP client can be pointed at the file without an `npm install` beside
 * it, and the npm package ships that one file with no dependencies. Node's own
 * modules stay external, as they must.
 */
export default defineConfig({
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    emptyOutDir: true,
    // The app's icons have no place beside a server.
    copyPublicDir: false,
    target: "node20",
    rollupOptions: {
      output: { entryFileNames: "propresenter-mcp.mjs", banner: "#!/usr/bin/env node" },
    },
  },
  ssr: { noExternal: true, target: "node" },
  test: { name: "mcp" },
});

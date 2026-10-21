import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { version } from "../../package.json";
import { LibraryError } from "./library";
import {
  auditMediaBin,
  checkPresentations,
  listPresentations,
  readMediaBin,
  readPresentationFile,
  searchText,
} from "./tools";

/**
 * An MCP server that reads a ProPresenter 7 library from disk. Started by
 * `main.ts`; built separately so tests can drive it over an in-memory pipe.
 *
 * Read-only. ProPresenter's own network API can show and trigger slides but
 * cannot edit them; this reads the files instead, through the same decoding
 * and checks the browser app uses.
 */

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const MEDIA_BIN_INPUT = {
  path: z.string().optional().describe("The media bin file. Defaults to Playlists/Media in the library folder."),
};

/**
 * Wrap a tool's answer for the wire.
 *
 * A `LibraryError` is something the model can act on -- a wrong path, a file
 * that is a chord chart -- so it goes back as a tool error rather than a
 * protocol failure, which a client may show to nobody.
 */
async function answer(run: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await run()) }] };
  } catch (e) {
    if (!(e instanceof LibraryError)) throw e;
    return { isError: true, content: [{ type: "text" as const, text: e.message }] };
  }
}

export function createServer(roots: readonly string[]): McpServer {
  const server = new McpServer(
    { name: "propresenter-garage", version },
    {
      instructions:
        `Reads ProPresenter 7 files under: ${roots.join(", ")}. ` +
        "Paths may be absolute or relative to those folders. Nothing is written.",
    }
  );

  server.registerTool(
    "list_presentations",
    {
      title: "List presentations",
      description:
        "List ProPresenter presentation (.pro) files in the library folders. Optionally filter by a " +
        "case- and accent-insensitive substring of the file name.",
      inputSchema: {
        query: z.string().optional().describe("Part of the presentation's name, e.g. 'amazing grace'."),
        limit: z.number().int().min(1).max(2000).optional().describe("Maximum results (default 200)."),
      },
      annotations: READ_ONLY,
    },
    (args) => answer(() => listPresentations(roots, args))
  );

  server.registerTool(
    "read_presentation",
    {
      title: "Read a presentation",
      description:
        "Read a presentation's slides: label, arrangement group and the text of every text box, line " +
        "by line. Also reports `fidelity`: whether the file would survive being written back.",
      inputSchema: { path: z.string().describe("Path of the .pro file.") },
      annotations: READ_ONLY,
    },
    ({ path: file }) => answer(() => readPresentationFile(roots, file))
  );

  server.registerTool(
    "search_text",
    {
      title: "Search slide text",
      description:
        "Find a phrase in the slide text of every presentation, ignoring case and accents. Returns the " +
        "file, slide, group and line of each match.",
      inputSchema: {
        query: z.string().describe("Text to find, e.g. a lyric."),
        folder: z.string().optional().describe("Search only this folder, e.g. one library."),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum matches (default 50)."),
      },
      annotations: READ_ONLY,
    },
    (args) => answer(() => searchText(roots, args))
  );

  server.registerTool(
    "check_presentations",
    {
      title: "Check presentation text",
      description:
        "Run the text checks from ProPresenter Garage's Presentations tool: leading/trailing/repeated " +
        "spaces, blank lines inside a slide, and lines ending in a comma, semicolon or full stop. " +
        "Takes one .pro file or a folder; with neither, checks every library. Lists only files with findings.",
      inputSchema: {
        path: z.string().optional().describe("A .pro file or a folder."),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum files listed (default 100)."),
      },
      annotations: READ_ONLY,
    },
    (args) => answer(() => checkPresentations(roots, args))
  );

  server.registerTool(
    "read_media_bin",
    {
      title: "Read the media bin",
      description:
        "Read ProPresenter's media bin: every playlist and the media items in it, with any mirroring, " +
        "rotation, crop or effects applied to each.",
      inputSchema: MEDIA_BIN_INPUT,
      annotations: READ_ONLY,
    },
    ({ path: file }) => answer(() => readMediaBin(roots, file))
  );

  server.registerTool(
    "audit_media_bin",
    {
      title: "Audit the media bin",
      description:
        "Audit the media bin: duplicates within and across playlists, deliberate variants of one file, " +
        "empty playlists, hidden items, items on external volumes and names that do not match their file.",
      inputSchema: MEDIA_BIN_INPUT,
      annotations: READ_ONLY,
    },
    ({ path: file }) => answer(() => auditMediaBin(roots, file))
  );

  return server;
}

# propresenter-garage-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant
read a ProPresenter 7 library from disk. Part of
[ProPresenter Garage](https://github.com/eugenius1/propresenter-garage).

- List and search presentations, and read their slides line by line
- See what each file records about itself: when ProPresenter last edited and
  last showed it, category, notes, CCLI details, key and arrangements
- Run the Presentations text checks on a file or a whole library
- Read or audit the media bin
- Read the presentation playlists: each service and the songs, headers and
  media in it
- List the themes, and preview giving a presentation the look of a theme slide
  or of another presentation's slide, slide by slide

It is **read-only**: it never writes a file, and it reads nothing outside the
folders you give it.

## Use

```bash
claude mcp add propresenter -- npx -y propresenter-garage-mcp ~/Documents/ProPresenter
```

Any MCP client that starts a local server over stdio takes the same command:
`npx`, then `-y propresenter-garage-mcp` and one or more library folders. With
no folder it reads `~/Documents/ProPresenter`. Needs Node 20 or later; the
package is one file with no dependencies.

For Claude Desktop there is also a one-click extension (`.mcpb`): see the
[main README](https://github.com/eugenius1/propresenter-garage#claude-desktop).

## Licence

GPL-3.0-or-later.

# Unread Dot

A small Obsidian plugin that marks newly created files with a blue dot in the file explorer and clears the dot the moment you open the file. Helps you spot notes you have not yet read without having to maintain any frontmatter or tags.

## Features

- New files (any extension) get a blue dot in the file explorer the moment they are created.
- The dot disappears the first time you click the file in the explorer or open it in a tab.
- State persists across restarts in `.obsidian/plugins/unread-dot/data.json`.
- Renaming or moving a file preserves its unread state.
- File-explorer only. Wikilinks, graph view, and the editor are untouched.
- Optional ignore lists by extension or path prefix (e.g., skip attachments).
- Right-click any file for "Mark as read" / "Mark as unread".
- Commands: "Mark all notes as read", "Mark current note as unread".

## First-run behavior

Existing files in the vault when you install the plugin are treated as already read. Only files created from that point forward get tracked. This avoids flooding the explorer with dots on day one.

## Installation

### From Community Plugins (once approved)

1. Settings → Community plugins → Browse
2. Search for "Unread Dot"
3. Install and enable

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/denmojo/obsidian-unread-dot/releases).
2. Create a folder `.obsidian/plugins/unread-dot/` inside your vault.
3. Drop the three files into that folder.
4. Restart Obsidian and enable the plugin in Settings → Community plugins.

### Via BRAT (pre-release testing)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Add the beta plugin: `denmojo/obsidian-unread-dot`.
3. Enable it in Settings → Community plugins.

## Settings

- **Ignored extensions** - comma-separated list of extensions (no leading dot) to skip. Example: `png, jpg, pdf, opus`.
- **Ignored path prefixes** - one path per line. Files whose path starts with any of these will not be marked. Example: `Attachments/` or `Archive/`.
- **Mark all read** button - clears every unread mark in the vault.

Changes to ignore rules apply immediately and prune any currently marked files that match.

## Commands

| Command | Description |
| --- | --- |
| Unread Dot: Mark all notes as read | Clears every unread mark. |
| Unread Dot: Mark current note as unread | Adds the active note back to the unread set. |

## Right-click menu

Right-click any file in the explorer to toggle its unread state. Files matching an ignore rule do not show the menu item.

## Known limitations

- Tracked state lives in the vault's `.obsidian/` folder, so it syncs across devices only if you sync `.obsidian/` (e.g., Obsidian Sync, Syncthing).
- The plugin uses Obsidian's internal `view.fileItems` to attach the marker. This is widely used by community plugins but is not part of the public API and may need adjustment if Obsidian changes the file-explorer internals.

## License

MIT - see [LICENSE](LICENSE).

# Browser Bookmarks Sync (Obsidian plugin)

Imports Safari, Chrome or Firefox bookmarks as one Markdown note each, using your own template.
Desktop only (it reads browser files with Node.js APIs inside Obsidian's Electron runtime).

## Install

Build from source:

    npm install
    npm run build          # type-checks, then bundles to main.js

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/browser-bookmarks-sync/`,
then enable the plugin under Settings → Community plugins. (`npm run dev` rebuilds on change.)

## First run

Pick a browser, check the detected file path in settings, then run **Sync Browser Bookmarks Now**
(ribbon icon or command palette). Automatic syncs (interval / on startup) stay disabled until one manual
sync has succeeded, so nothing is imported by surprise.

## Browsers

| Browser | Default file | Notes |
|---|---|---|
| Chrome | `…/Chrome/Default/Bookmarks` (macOS / Windows / Linux) | JSON. Other profiles/Chromium browsers: set the path. |
| Safari | `~/Library/Safari/Bookmarks.plist` | Binary plist, parsed in-process with `bplist-parser`. Obsidian needs **Full Disk Access** (System Settings → Privacy & Security). Safari stores no creation date, so `{{date}}` falls back to the sync date. Reading List is excluded. |
| Firefox | auto-detected `places.sqlite` | Read through the `sqlite3` CLI on a temp snapshot of the DB + WAL (live data). No `sqlite3` (e.g. Windows)? Point the path at a `bookmarkbackups/*.jsonlz4` file or folder – decoded natively, but only as fresh as Firefox's daily backup. |

## Template placeholders

`{{title}}` `{{url}}` `{{date}}` `{{folder_path}}` plus `{{folder}}` `{{domain}}` `{{browser}}` `{{synced}}`.
Dates take a moment.js format: `{{date:YYYY-MM-DD HH:mm}}`. Add `|yaml` to quote a value safely in front matter:
`title: {{title|yaml}}`.

## Sync behaviour

* **Only sync new bookmarks** (default): a bookmark that already has a note is never touched.
* **Apply templates to existing bookmarks**: existing notes are rewritten when the rendered result differs
  (via `vault.process`, i.e. atomically). Manual edits to those notes are overwritten.
* A bookmark is matched to its note by (1) the plugin's URL → path index in `data.json` (kept in sync when you
  rename/move notes), then (2) an existing `<title>.md` that contains the URL. Same-title bookmarks with different
  URLs get a short hash suffix. The same URL in several folders yields one note (first occurrence wins).
* Deleting a note makes its bookmark "new" again, so the next sync recreates it.

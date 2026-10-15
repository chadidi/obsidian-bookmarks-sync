import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { placesRowsToEntries, readFirefoxBookmarks } from "../src/sources/firefox";
import { BookmarkSourceError } from "../src/errors";
import { Logger } from "../src/logger";

const silentLogger = new Logger(() => false);

test("placesRowsToEntries reconstructs hierarchy and handles root mappings", () => {
  const rows = [
    // Roots
    { id: 1, parent: 0, type: 2, title: null, guid: "root________", dateAdded: null, url: null },
    { id: 2, parent: 1, type: 2, title: null, guid: "menu________", dateAdded: null, url: null },
    { id: 3, parent: 1, type: 2, title: null, guid: "toolbar_____", dateAdded: null, url: null },
    { id: 4, parent: 1, type: 2, title: null, guid: "tags________", dateAdded: null, url: null },

    // Custom subfolder under Toolbar
    { id: 10, parent: 3, type: 2, title: "Articles", guid: "guid-f-10", dateAdded: null, url: null },

    // Bookmarks
    {
      id: 100,
      parent: 2,
      type: 1,
      title: "Mozilla",
      guid: "guid-bm-1",
      dateAdded: 1700000000000000, // microseconds
      url: "https://www.mozilla.org",
    },
    {
      id: 101,
      parent: 10,
      type: 1,
      title: "Rust Lang",
      guid: "guid-bm-2",
      dateAdded: 1700000000000000,
      url: "https://www.rust-lang.org",
    },
    // Bookmark in tag folder (should be skipped)
    {
      id: 102,
      parent: 4,
      type: 1,
      title: "Tagged Item",
      guid: "guid-bm-3",
      dateAdded: null,
      url: "https://tagged.example.com",
    },
    // Non-bookmark row (folder or separator)
    {
      id: 103,
      parent: 2,
      type: 3, // separator
      title: null,
      guid: "guid-sep-1",
      dateAdded: null,
      url: null,
    },
    // Non-importable URL (Firefox smart query)
    {
      id: 104,
      parent: 2,
      type: 1,
      title: "Most Visited",
      guid: "guid-smart-1",
      dateAdded: null,
      url: "place:sort=8&maxResults=10",
    },
  ];

  const entries = placesRowsToEntries(rows);

  assert.equal(entries.length, 2);

  // Bookmark 1 under Bookmarks Menu
  assert.equal(entries[0]?.title, "Mozilla");
  assert.equal(entries[0]?.url, "https://www.mozilla.org");
  assert.equal(entries[0]?.sourceId, "guid-bm-1");
  assert.deepEqual(entries[0]?.folderPath, ["Bookmarks Menu"]);
  assert.ok(entries[0]?.dateAdded instanceof Date);
  assert.equal(entries[0]?.browser, "firefox");

  // Bookmark 2 under Bookmarks Toolbar / Articles
  assert.equal(entries[1]?.title, "Rust Lang");
  assert.equal(entries[1]?.url, "https://www.rust-lang.org");
  assert.deepEqual(entries[1]?.folderPath, ["Bookmarks Toolbar", "Articles"]);
});

test("readFirefoxBookmarks reads JSON backup file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "firefox-test-"));
  const tmpFile = path.join(tmpDir, "bookmarks-2024.json");

  const backupData = {
    guid: "root________",
    title: "",
    children: [
      {
        guid: "menu________",
        root: "bookmarksMenuFolder",
        children: [
          {
            guid: "bm-json-1",
            title: "MDN Web Docs",
            type: "text/x-moz-place",
            uri: "https://developer.mozilla.org",
            dateAdded: 1700000000000000,
          },
        ],
      },
    ],
  };

  try {
    await fs.writeFile(tmpFile, JSON.stringify(backupData), "utf8");
    const entries = await readFirefoxBookmarks(
      tmpFile,
      { sqlite3Path: "sqlite3" },
      silentLogger,
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.title, "MDN Web Docs");
    assert.equal(entries[0]?.url, "https://developer.mozilla.org");
    assert.deepEqual(entries[0]?.folderPath, ["Bookmarks Menu"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("readFirefoxBookmarks throws error on empty directory without places or backups", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "firefox-test-"));

  try {
    await assert.rejects(
      () => readFirefoxBookmarks(tmpDir, { sqlite3Path: "sqlite3" }, silentLogger),
      (err: unknown) =>
        err instanceof BookmarkSourceError &&
        /contains neither places\.sqlite nor bookmarks-\*\.jsonlz4 backups/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

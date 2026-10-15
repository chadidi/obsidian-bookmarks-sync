import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readChromeBookmarks } from "../src/sources/chrome";
import { BookmarkSourceError } from "../src/errors";
import { Logger } from "../src/logger";

const silentLogger = new Logger(() => false);

const mockChromeJson = {
  roots: {
    bookmark_bar: {
      name: "Bookmarks Bar",
      children: [
        {
          id: "1",
          guid: "guid-1",
          name: "Obsidian",
          type: "url",
          url: "https://obsidian.md",
          date_added: "13350000000000000", // WebKit timestamp
        },
        {
          id: "2",
          name: "Dev Tools",
          type: "folder",
          children: [
            {
              id: "3",
              guid: "guid-3",
              name: "GitHub",
              type: "url",
              url: "https://github.com",
              date_added: "13350000000000000",
            },
            {
              id: "4",
              name: "Bookmarklet",
              type: "url",
              url: "javascript:void(0)", // Should be ignored
            },
          ],
        },
      ],
    },
    other: {
      name: "Other Bookmarks",
      children: [
        {
          id: "5",
          guid: "guid-5",
          name: "MDN",
          type: "url",
          url: "https://developer.mozilla.org",
        },
      ],
    },
  },
};

test("readChromeBookmarks parses hierarchical Chrome JSON", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-test-"));
  const tmpFile = path.join(tmpDir, "Bookmarks");

  try {
    await fs.writeFile(tmpFile, JSON.stringify(mockChromeJson), "utf8");
    const bookmarks = await readChromeBookmarks(tmpFile, silentLogger);

    assert.equal(bookmarks.length, 3);

    // First bookmark
    assert.equal(bookmarks[0]?.title, "Obsidian");
    assert.equal(bookmarks[0]?.url, "https://obsidian.md");
    assert.deepEqual(bookmarks[0]?.folderPath, ["Bookmarks Bar"]);
    assert.ok(bookmarks[0]?.dateAdded instanceof Date);
    assert.equal(bookmarks[0]?.browser, "chrome");

    // Nested bookmark
    assert.equal(bookmarks[1]?.title, "GitHub");
    assert.deepEqual(bookmarks[1]?.folderPath, ["Bookmarks Bar", "Dev Tools"]);

    // Other bookmarks
    assert.equal(bookmarks[2]?.title, "MDN");
    assert.deepEqual(bookmarks[2]?.folderPath, ["Other Bookmarks"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("readChromeBookmarks throws BookmarkSourceError on malformed file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-test-"));
  const tmpFile = path.join(tmpDir, "CorruptBookmarks");

  try {
    await fs.writeFile(tmpFile, "{ not valid json", "utf8");
    await assert.rejects(
      () => readChromeBookmarks(tmpFile, silentLogger),
      (err: unknown) => err instanceof BookmarkSourceError && /is not valid JSON/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("readChromeBookmarks throws BookmarkSourceError when roots section is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-test-"));
  const tmpFile = path.join(tmpDir, "NoRootsBookmarks");

  try {
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1 }), "utf8");
    await assert.rejects(
      () => readChromeBookmarks(tmpFile, silentLogger),
      (err: unknown) => err instanceof BookmarkSourceError && /has no "roots" section/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

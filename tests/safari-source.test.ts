import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readSafariBookmarks } from "../src/sources/safari";
import { BookmarkSourceError } from "../src/errors";
import { Logger } from "../src/logger";

const silentLogger = new Logger(() => false);

// Base64-encoded valid Apple binary property list (bplist00) containing:
// - BookmarksBar (Favorites) -> Apple (https://apple.com)
// - BookmarksBar -> Dev -> WebKit (https://webkit.org)
// - com.apple.ReadingList (which must be ignored)
const SAMPLE_SAFARI_BPLIST_B64 =
  "YnBsaXN0MDDSAQIDKFhDaGlsZHJlbl8QD1dlYkJvb2ttYXJrVHlwZaIEHdMFAgEGBwhVVGl0bGVcQm9va21hcmtzQmFyXxATV2ViQm9va21hcmtUeXBlTGlzdKIJE9QKCwIMDQ4PEF8QD1dlYkJvb2ttYXJrVVVJRFlVUkxTdHJpbmddVVJJRGljdGlvbmFyeV11dWlkLXNhZmFyaS0xXxARaHR0cHM6Ly9hcHBsZS5jb21fEBNXZWJCb29rbWFya1R5cGVMZWFm0RESVXRpdGxlVUFwcGxl0wUCARQVFlNEZXZfEBNXZWJCb29rbWFya1R5cGVMaXN0oRfUGAsCBRkaGxxfEA9XZWJCb29rbWFya1VVSURddXVpZC1zYWZhcmktMl8QEmh0dHBzOi8vd2Via2l0Lm9yZ18QE1dlYkJvb2ttYXJrVHlwZUxlYWZWV2ViS2l00wUCAR4fIF8QFWNvbS5hcHBsZS5SZWFkaW5nTGlzdF8QE1dlYkJvb2ttYXJrVHlwZUxpc3ShIdQiCwIMIyQlJl8QD1dlYkJvb2ttYXJrVVVJRF5yZWFkaW5nLWxpc3QtMV8QH2h0dHBzOi8vcmVhZGluZ2xpc3QuZXhhbXBsZS5jb21fEBNXZWJCb29rbWFya1R5cGVMZWFm0REnXxAUUmVhZGluZyBMaXN0IEFydGljbGVfEBNXZWJCb29rbWFya1R5cGVMaXN0AAgADQAWACgAKwAyADgARQBbAF4AZwB5AIMAkQCfALMAyQDMANIA2ADfAOMA+QD7AQQBFgEkATkBTwFWAV0BdQGLAY0BlgGoAbcB2QHvAfICCQAAAAAAAAIBAAAAAAAAACkAAAAAAAAAAAAAAAAAAAIf";

test("readSafariBookmarks parses binary plist and maps folders correctly", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safari-test-"));
  const tmpFile = path.join(tmpDir, "Bookmarks.plist");

  try {
    await fs.writeFile(tmpFile, Buffer.from(SAMPLE_SAFARI_BPLIST_B64, "base64"));
    const bookmarks = await readSafariBookmarks(tmpFile, silentLogger);

    // Should contain Apple and WebKit, but NOT Reading List
    assert.equal(bookmarks.length, 2);

    // BookmarksBar is mapped to "Favorites"
    assert.equal(bookmarks[0]?.title, "Apple");
    assert.equal(bookmarks[0]?.url, "https://apple.com");
    assert.equal(bookmarks[0]?.sourceId, "uuid-safari-1");
    assert.deepEqual(bookmarks[0]?.folderPath, ["Favorites"]);
    assert.equal(bookmarks[0]?.browser, "safari");

    // Nested in Dev folder
    assert.equal(bookmarks[1]?.title, "WebKit");
    assert.equal(bookmarks[1]?.url, "https://webkit.org");
    assert.equal(bookmarks[1]?.sourceId, "uuid-safari-2");
    assert.deepEqual(bookmarks[1]?.folderPath, ["Favorites", "Dev"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("readSafariBookmarks throws BookmarkSourceError on corrupted plist", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "safari-test-"));
  const tmpFile = path.join(tmpDir, "CorruptBookmarks.plist");

  try {
    // Malformed bplist header
    await fs.writeFile(tmpFile, Buffer.from("bplist00NotValidDataHere"), "utf8");
    await assert.rejects(
      () => readSafariBookmarks(tmpFile, silentLogger),
      (err: unknown) => err instanceof BookmarkSourceError && /Could not parse/i.test((err as Error).message),
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

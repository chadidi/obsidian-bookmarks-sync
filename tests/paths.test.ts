import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  chromeBookmarkFile,
  expandPath,
  defaultBrowserPath,
  resolveSourcePath,
} from '../src/paths';
import { BookmarkSourceError } from '../src/errors';

test('expandPath expands tilde and environment variables', () => {
  const home = os.homedir();
  assert.equal(expandPath('~'), home);
  assert.equal(
    expandPath('~/Documents/bookmarks.json'),
    path.join(home, 'Documents', 'bookmarks.json'),
  );
  assert.equal(expandPath(''), '');

  process.env.TEST_VAR = 'my_custom_folder';
  assert.equal(
    expandPath('/path/to/$TEST_VAR/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  assert.equal(
    expandPath('/path/to/${TEST_VAR}/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  assert.equal(
    expandPath('/path/to/%TEST_VAR%/file'),
    path.normalize('/path/to/my_custom_folder/file'),
  );
  delete process.env.TEST_VAR;
});

test('defaultBrowserPath returns expected path format by platform', () => {
  const chromePath = defaultBrowserPath('chrome');
  assert.ok(chromePath.length > 0);
  assert.match(chromePath, /Bookmarks/);

  if (process.platform === 'darwin') {
    const safariPath = defaultBrowserPath('safari');
    assert.match(safariPath, /Safari[/\\]Bookmarks\.plist/);
  } else {
    assert.equal(defaultBrowserPath('safari'), '');
  }
});

test('resolveSourcePath prioritizes configured path and expands it', () => {
  const custom = resolveSourcePath('chrome', '~/custom-bookmarks.json');
  assert.equal(custom, path.join(os.homedir(), 'custom-bookmarks.json'));
});

test('resolveSourcePath falls back to defaultBrowserPath when empty', () => {
  const resolved = resolveSourcePath('chrome', '');
  assert.equal(resolved, defaultBrowserPath('chrome'));
});

test('resolveSourcePath throws BookmarkSourceError on unsupported platform without configured path', () => {
  if (process.platform !== 'darwin') {
    assert.throws(
      () => resolveSourcePath('safari', ''),
      (err: unknown) => {
        return (
          err instanceof BookmarkSourceError &&
          /No default Safari bookmarks location is known/i.test(err.message)
        );
      },
    );
  }
});

test('chromeBookmarkFile prefers Bookmarks and falls back to AccountBookmarks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-chrome-'));
  try {
    // Neither file exists: keep the canonical local path.
    assert.equal(chromeBookmarkFile(dir), path.join(dir, 'Bookmarks'));

    // Signed-in Chrome with only synced bookmarks.
    fs.writeFileSync(path.join(dir, 'AccountBookmarks'), '{}');
    assert.equal(chromeBookmarkFile(dir), path.join(dir, 'AccountBookmarks'));

    // A local Bookmarks file takes precedence once present.
    fs.writeFileSync(path.join(dir, 'Bookmarks'), '{}');
    assert.equal(chromeBookmarkFile(dir), path.join(dir, 'Bookmarks'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

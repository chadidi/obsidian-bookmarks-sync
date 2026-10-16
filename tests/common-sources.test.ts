import test from 'node:test';
import assert from 'node:assert/strict';
import { isImportableUrl, translateFsError } from '../src/sources/common';
import { BookmarkSourceError } from '../src/errors';

test('isImportableUrl accepts valid URLs and rejects invalid/script schemes', () => {
  assert.equal(isImportableUrl('https://example.com'), true);
  assert.equal(isImportableUrl('http://localhost:3000/path'), true);
  assert.equal(isImportableUrl('ftp://files.example.org'), true);
  assert.equal(isImportableUrl('obsidian://open?vault=test'), true);

  // Rejects javascript: bookmarklets
  assert.equal(isImportableUrl('javascript:alert(1)'), false);
  assert.equal(isImportableUrl('JAVASCRIPT:void(0)'), false);

  // Rejects Firefox smart folders
  assert.equal(isImportableUrl('place:folder=2'), false);

  // Rejects non-URLs or schemes missing
  assert.equal(isImportableUrl('example.com'), false);
  assert.equal(isImportableUrl(''), false);
  assert.equal(isImportableUrl('   '), false);
  assert.equal(isImportableUrl(null), false);
  assert.equal(isImportableUrl(undefined), false);
  assert.equal(isImportableUrl(123), false);
  assert.equal(isImportableUrl({}), false);
});

test('translateFsError wraps ENOENT with friendly message', () => {
  const err = Object.assign(new Error('File not found'), { code: 'ENOENT' });
  const result = translateFsError(err, '/path/to/Bookmarks');
  assert.ok(result instanceof BookmarkSourceError);
  assert.match(result.message, /File not found: \/path\/to\/Bookmarks/);
});

test('translateFsError wraps EACCES and EPERM with permission hint', () => {
  const errAccess = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
  const hint = 'Grant Full Disk Access.';
  const res1 = translateFsError(errAccess, '/path/to/Bookmarks.plist', { permission: hint });
  assert.match(
    res1.message,
    /Permission denied reading \/path\/to\/Bookmarks\.plist\. Grant Full Disk Access\./,
  );

  const errPerm = Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
  const res2 = translateFsError(errPerm, '/path/to/places.sqlite');
  assert.match(res2.message, /Permission denied reading \/path\/to\/places\.sqlite\./);
});

test('translateFsError wraps EBUSY with retry message', () => {
  const errBusy = Object.assign(new Error('Resource busy'), { code: 'EBUSY' });
  const res = translateFsError(errBusy, '/path/to/places.sqlite');
  assert.match(res.message, /locked by another program/);
});

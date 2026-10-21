import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowsersSync } from 'browsers-detect';
import { resolveSourcePath } from '../src/paths';

test('resolveSourcePath uses the first detected profile when none is selected', (t) => {
  const detected = detectBrowsersSync().find(
    (browser) => browser.profiles[0]?.bookmarkPaths.length > 0,
  );
  if (!detected) return t.skip('No browser bookmark profile is available on this machine');

  const profile = detected.profiles[0];
  assert.ok(profile);
  assert.equal(resolveSourcePath(detected.id, ''), profile.bookmarkPaths[0]);
});

test('resolveSourcePath uses the explicitly selected detected profile', (t) => {
  const detected = detectBrowsersSync().find((browser) =>
    browser.profiles.some((profile) => profile.bookmarkPaths.length > 0),
  );
  if (!detected) return t.skip('No browser bookmark profile is available on this machine');

  const profile = detected.profiles.find((candidate) => candidate.bookmarkPaths.length > 0);
  assert.ok(profile);
  assert.equal(resolveSourcePath(detected.id, profile.id), profile.bookmarkPaths[0]);
});

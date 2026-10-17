import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS, isVaultRootTarget } from '../src/settings';
import { CUSTOM_TEMPLATE_ID, DEFAULT_TEMPLATE } from '../src/template-store';

test('normalizeSettings returns defaults when given undefined or empty object', () => {
  const settings = normalizeSettings(undefined);
  assert.deepEqual(settings, DEFAULT_SETTINGS);

  const empty = normalizeSettings({});
  assert.deepEqual(empty, DEFAULT_SETTINGS);
});

test('normalizeSettings clamps intervalMinutes to [0, 10080]', () => {
  const negative = normalizeSettings({ intervalMinutes: -10 });
  assert.equal(negative.intervalMinutes, 0);

  const excessive = normalizeSettings({ intervalMinutes: 999999 });
  assert.equal(excessive.intervalMinutes, 10080);

  const valid = normalizeSettings({ intervalMinutes: 30.7 });
  assert.equal(valid.intervalMinutes, 30);
});

test('normalizeSettings validates browser and folderStructure', () => {
  const invalid = normalizeSettings({
    browser: 'internet-explorer' as any,
    folderStructure: 'unknown-structure' as any,
  });
  assert.equal(invalid.browser, 'chrome');
  assert.equal(invalid.folderStructure, 'folders');

  const valid = normalizeSettings({
    browser: 'firefox',
    folderStructure: 'flat',
  });
  assert.equal(valid.browser, 'firefox');
  assert.equal(valid.folderStructure, 'flat');
});

test('normalizeSettings keeps the selected template name', () => {
  assert.equal(normalizeSettings({}).templateName, 'simple');
  assert.equal(normalizeSettings({ templateName: 'full' }).templateName, 'full');
  assert.equal(normalizeSettings({ templateName: 'my-template' }).templateName, 'my-template');
  assert.equal(normalizeSettings({ templateName: '  spaced  ' }).templateName, 'spaced');
  assert.equal(normalizeSettings({ templateName: '' }).templateName, 'simple');
});

test('normalizeSettings migrates legacy template presets to template names', () => {
  assert.equal(normalizeSettings({ templatePreset: 'full' }).templateName, 'full');
  assert.equal(normalizeSettings({ templatePreset: 'simple' }).templateName, 'simple');

  const custom = normalizeSettings({
    templatePreset: 'custom',
    template: '# Custom Bookmark\n{{title}}',
  });
  assert.equal(custom.templateName, CUSTOM_TEMPLATE_ID);
  assert.equal(custom.customTemplate, '# Custom Bookmark\n{{title}}');
});

test('normalizeSettings treats an unknown legacy template body as custom', () => {
  const legacyCustom = normalizeSettings({
    template: '# My Legacy Custom Template\n{{url}}',
  });
  assert.equal(legacyCustom.templateName, CUSTOM_TEMPLATE_ID);
  assert.equal(legacyCustom.customTemplate, '# My Legacy Custom Template\n{{url}}');

  const legacyDefault = normalizeSettings({ customTemplate: DEFAULT_TEMPLATE });
  assert.equal(legacyDefault.templateName, 'simple');
});

test('isVaultRootTarget only accepts an empty or "/" target folder', () => {
  assert.equal(isVaultRootTarget(''), true);
  assert.equal(isVaultRootTarget('   '), true);
  assert.equal(isVaultRootTarget('/'), true);
  assert.equal(isVaultRootTarget(' / '), true);
  assert.equal(isVaultRootTarget('Bookmarks'), false);
  assert.equal(isVaultRootTarget('Bookmarks/Sub'), false);
});

test('normalizeSettings defaults allowVaultRootTarget to false and coerces stray values', () => {
  assert.equal(normalizeSettings({}).allowVaultRootTarget, false);
  assert.equal(normalizeSettings({ allowVaultRootTarget: true }).allowVaultRootTarget, true);
  assert.equal(
    normalizeSettings({ allowVaultRootTarget: 'yes' as unknown as boolean }).allowVaultRootTarget,
    false,
  );
});

test('normalizeSettings forces allowVaultRootTarget off when the target is the vault root', () => {
  assert.equal(
    normalizeSettings({ targetFolder: '', allowVaultRootTarget: true }).allowVaultRootTarget,
    false,
  );
  assert.equal(
    normalizeSettings({ targetFolder: '/', allowVaultRootTarget: true }).allowVaultRootTarget,
    false,
  );
  assert.equal(
    normalizeSettings({ targetFolder: 'Bookmarks', allowVaultRootTarget: true })
      .allowVaultRootTarget,
    true,
  );
});

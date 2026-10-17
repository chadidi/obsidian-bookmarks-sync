import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  CUSTOM_TEMPLATE_ID,
  DEFAULT_TEMPLATE,
  TEMPLATE_NAMES,
  TEMPLATES,
  resolveTemplate,
} from '../src/template-store';

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

test('every template file in the folder is bundled under its file name', () => {
  const files = fs
    .readdirSync(templatesDir)
    .filter((file) => file.endsWith('.md'))
    .sort();

  assert.ok(files.length > 0, 'expected at least one template markdown file');
  assert.deepEqual(
    [...TEMPLATE_NAMES].sort(),
    files.map((file) => path.basename(file, '.md')),
  );

  for (const file of files) {
    const name = path.basename(file, '.md');
    assert.equal(TEMPLATES[name], fs.readFileSync(path.join(templatesDir, file), 'utf8'));
  }
});

test('the bundled templates keep their placeholders', () => {
  assert.match(TEMPLATES.simple ?? '', /\{\{url\}\}/);
  assert.match(TEMPLATES.full ?? '', /\{\{title\|yaml\}\}/);
  assert.equal(DEFAULT_TEMPLATE, TEMPLATES.simple);
});

test('resolveTemplate returns the selected bundled template', () => {
  const settings = { templateName: 'full', customTemplate: 'mine' };
  assert.equal(resolveTemplate(settings), TEMPLATES.full);
});

test('resolveTemplate prefers the custom body when Custom is selected', () => {
  assert.equal(
    resolveTemplate({ templateName: CUSTOM_TEMPLATE_ID, customTemplate: '# Mine\n{{url}}' }),
    '# Mine\n{{url}}',
  );
});

test('resolveTemplate falls back to the default for unknown or empty selections', () => {
  assert.equal(resolveTemplate({ templateName: 'nope', customTemplate: '' }), DEFAULT_TEMPLATE);
  assert.equal(
    resolveTemplate({ templateName: CUSTOM_TEMPLATE_ID, customTemplate: '   ' }),
    DEFAULT_TEMPLATE,
  );
});

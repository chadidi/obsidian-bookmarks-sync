import test from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  findUnknownPlaceholders,
  type TemplateContext,
  type DateFormatter,
} from "../src/template";

const dummyFormatter: DateFormatter = (date, format) => {
  const iso = date.toISOString();
  if (format === "YYYY-MM-DD") return iso.slice(0, 10);
  if (format === "HH:mm") return iso.slice(11, 16);
  return `${iso}_${format}`;
};

const baseCtx: TemplateContext = {
  title: 'My "Awesome" Article: A Deep Dive',
  url: "https://www.example.com/posts/123?ref=feed",
  date: new Date("2024-03-15T10:30:00.000Z"),
  synced: new Date("2024-03-16T12:00:00.000Z"),
  folderPath: ["Bookmarks Bar", "Tech", "JavaScript"],
  browser: "chrome",
};

test("renderTemplate replaces standard placeholders", () => {
  const template = `Title: {{title}}\nURL: {{url}}\nDate: {{date}}\nSynced: {{synced}}\nDomain: {{domain}}\nBrowser: {{browser}}\nFolder: {{folder}}\nPath: {{folder_path}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, "YYYY-MM-DD");

  assert.match(rendered, /Title: My "Awesome" Article: A Deep Dive/);
  assert.match(rendered, /URL: https:\/\/www\.example\.com\/posts\/123\?ref=feed/);
  assert.match(rendered, /Date: 2024-03-15/);
  assert.match(rendered, /Synced: 2024-03-16/);
  assert.match(rendered, /Domain: example\.com/);
  assert.match(rendered, /Browser: Google Chrome/);
  assert.match(rendered, /Folder: JavaScript/);
  assert.match(rendered, /Path: Bookmarks Bar\/Tech\/JavaScript/);
});

test("renderTemplate supports date formatting arguments", () => {
  const template = `Added: {{date:HH:mm}} | Synced: {{synced:HH:mm}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, "YYYY-MM-DD");

  assert.equal(rendered, "Added: 10:30 | Synced: 12:00");
});

test("renderTemplate supports filters (yaml, lower, upper)", () => {
  const template = `YAML: {{title|yaml}}\nLower: {{browser|lower}}\nUpper: {{domain|upper}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, "YYYY-MM-DD");

  assert.equal(
    rendered,
    `YAML: ${JSON.stringify(baseCtx.title)}\nLower: google chrome\nUpper: EXAMPLE.COM`,
  );
});

test("renderTemplate leaves unknown placeholders intact", () => {
  const template = `{{title}} by {{author}} with {{tag|lower}}`;
  const rendered = renderTemplate(template, baseCtx, dummyFormatter, "YYYY-MM-DD");

  assert.equal(rendered, `${baseCtx.title} by {{author}} with {{tag|lower}}`);
});

test("renderTemplate handles edge cases (empty folders, invalid url)", () => {
  const emptyCtx: TemplateContext = {
    ...baseCtx,
    url: "not-a-valid-url",
    folderPath: [],
    browser: "safari",
  };
  const template = `Domain: '{{domain}}' | Folder: '{{folder}}' | Path: '{{folder_path}}' | Browser: {{browser}}`;
  const rendered = renderTemplate(template, emptyCtx, dummyFormatter, "YYYY-MM-DD");

  assert.equal(
    rendered,
    "Domain: '' | Folder: '' | Path: '' | Browser: Safari",
  );
});

test("findUnknownPlaceholders identifies invalid placeholders", () => {
  const valid = `---
title: {{title|yaml}}
url: {{url}}
folder: {{folder}}
path: {{folder_path}}
date: {{date:YYYY-MM-DD}}
synced: {{synced}}
domain: {{domain}}
browser: {{browser}}
---`;
  assert.deepEqual(findUnknownPlaceholders(valid), []);

  const invalid = `Hello {{name}}! Read {{book:chapter|upper}} from {{source}} with {{title}}`;
  const unknowns = findUnknownPlaceholders(invalid);
  assert.deepEqual(unknowns.sort(), ["{{book}}", "{{name}}", "{{source}}"]);
});

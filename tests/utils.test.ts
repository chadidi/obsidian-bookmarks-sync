import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFileName,
  sanitizeFolderName,
  shortHash,
  joinVaultPath,
  hasOwn,
} from "../src/utils";

test("sanitizeFileName basic cleaning", () => {
  assert.equal(sanitizeFileName("Simple Title"), "Simple Title");
  assert.equal(sanitizeFileName("Title with / and \\ slashes"), "Title with - and - slashes");
  assert.equal(sanitizeFileName("Colons: and | pipes"), "Colons- and - pipes");
  assert.equal(sanitizeFileName('Quotes "and" *stars* and <brackets>'), "Quotes and stars and brackets");
  assert.equal(sanitizeFileName("Question? mark"), "Question mark");
});

test("sanitizeFileName strips wikilink-breaking characters", () => {
  // Obsidian wikilinks break on # ^ [ ]
  assert.equal(sanitizeFileName("C# Programming [2024] ^top"), "C Programming 2024 top");
});

test("sanitizeFileName strips zero-width and control characters", () => {
  const zeroWidth = "Hidden\u200BText\uFEFF";
  assert.equal(sanitizeFileName(zeroWidth), "HiddenText");
  const controlChars = "Hello\u0000\u001fWorld";
  assert.equal(sanitizeFileName(controlChars), "HelloWorld");
});

test("sanitizeFileName handles dots, spaces and empty results", () => {
  assert.equal(sanitizeFileName("...leading dots"), "leading dots");
  assert.equal(sanitizeFileName("trailing dots..."), "trailing dots");
  assert.equal(sanitizeFileName("   spaces   "), "spaces");
  assert.equal(sanitizeFileName(""), "Untitled");
  assert.equal(sanitizeFileName("   ...   "), "Untitled");
});

test("sanitizeFileName handles Windows reserved device names", () => {
  assert.equal(sanitizeFileName("CON"), "_CON");
  assert.equal(sanitizeFileName("con.txt"), "_con.txt");
  assert.equal(sanitizeFileName("aux"), "_aux");
  assert.equal(sanitizeFileName("NUL"), "_NUL");
  assert.equal(sanitizeFileName("COM1"), "_COM1");
  assert.equal(sanitizeFileName("LPT9.md"), "_LPT9.md");
});

test("sanitizeFileName respects maxLength without cutting surrogate pairs", () => {
  const emojiStr = "😀".repeat(60);
  const sanitized = sanitizeFileName(emojiStr, 10);
  assert.equal(Array.from(sanitized).length, 10);
  // Ensure the string didn't end up with lone high surrogates
  assert.doesNotThrow(() => sanitized.normalize("NFC"));
});

test("sanitizeFolderName preserves wikilink chars but removes OS reserved chars", () => {
  // Folder names are allowed to have #, ^, [ ], but not : * ? " < > | / \
  assert.equal(sanitizeFolderName("C# [Tags] ^special"), "C# [Tags] ^special");
  assert.equal(sanitizeFolderName("Folder/Sub:Invalid*"), "Folder-SubInvalid");
  assert.equal(sanitizeFolderName(""), "Untitled");
  assert.equal(sanitizeFolderName("CON"), "_CON");
});

test("shortHash generates reproducible SHA-1 prefix", () => {
  const hash1 = shortHash("https://example.com");
  const hash2 = shortHash("https://example.com");
  const hashDiff = shortHash("https://different.com");

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hashDiff);
  assert.equal(hash1.length, 6);
  assert.equal(shortHash("test", 10).length, 10);
});

test("joinVaultPath handles root and relative paths correctly", () => {
  assert.equal(joinVaultPath("", "Note.md"), "Note.md");
  assert.equal(joinVaultPath("/", "Note.md"), "Note.md");
  assert.equal(joinVaultPath("Bookmarks", "Note.md"), "Bookmarks/Note.md");
  assert.equal(joinVaultPath("Bookmarks/Dev", "Note.md"), "Bookmarks/Dev/Note.md");
});

test("hasOwn checks property existence safely", () => {
  const obj = Object.create(null);
  obj.foo = "bar";
  assert.equal(hasOwn(obj, "foo"), true);
  assert.equal(hasOwn(obj, "baz"), false);

  const regular = { a: 1 };
  assert.equal(hasOwn(regular, "a"), true);
  assert.equal(hasOwn(regular, "toString"), false);
});

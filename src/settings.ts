import type { BookmarkSettings, BrowserType, FolderStructure } from "./types";

export const DEFAULT_TEMPLATE = `---
title: {{title|yaml}}
url: {{url|yaml}}
folder: {{folder_path|yaml}}
date: {{date}}
source: {{browser}}
tags:
  - bookmark
---

# {{title}}

{{url}}

**Folder:** {{folder_path}}
`;

export const DEFAULT_SETTINGS: BookmarkSettings = {
  browser: "chrome",
  paths: { chrome: "", firefox: "", safari: "" },
  sqlite3Path: "sqlite3",
  targetFolder: "Bookmarks",
  rootFolder: "",
  folderStructure: "folders",
  intervalMinutes: 60,
  syncOnStartup: false,
  applyToExisting: false,
  dateFormat: "YYYY-MM-DD",
  template: DEFAULT_TEMPLATE,
  debug: false,
  initialSyncDone: false,
};

const BROWSERS: BrowserType[] = ["chrome", "firefox", "safari"];

/** Merges stored data over the defaults and repairs any invalid values. */
export function normalizeSettings(raw: Partial<BookmarkSettings> | undefined | null): BookmarkSettings {
  const merged: BookmarkSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    paths: { ...DEFAULT_SETTINGS.paths, ...(raw?.paths ?? {}) },
  };
  if (!BROWSERS.includes(merged.browser)) merged.browser = DEFAULT_SETTINGS.browser;
  if (!Number.isFinite(merged.intervalMinutes) || merged.intervalMinutes < 0) {
    merged.intervalMinutes = DEFAULT_SETTINGS.intervalMinutes;
  }
  merged.intervalMinutes = Math.min(Math.floor(merged.intervalMinutes), 10080); // max one week
  if (typeof merged.template !== "string" || !merged.template.trim()) merged.template = DEFAULT_TEMPLATE;
  if (!merged.dateFormat) merged.dateFormat = DEFAULT_SETTINGS.dateFormat;
  if (!merged.sqlite3Path) merged.sqlite3Path = DEFAULT_SETTINGS.sqlite3Path;
  if (typeof merged.rootFolder !== "string") merged.rootFolder = "";
  const FOLDER_STRUCTURES: FolderStructure[] = ["folders", "flat"];
  if (!FOLDER_STRUCTURES.includes(merged.folderStructure)) merged.folderStructure = "folders";
  return merged;
}

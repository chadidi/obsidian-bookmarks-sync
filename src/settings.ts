import type { BookmarkSettings, BrowserType, FolderStructure, TemplatePreset } from "./types";

export const FULL_TEMPLATE = `---
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

export const SIMPLE_TEMPLATE = `[{{url}}]({{url}})
`;

export const PRESET_TEMPLATES: Record<"simple" | "full", string> = {
  simple: SIMPLE_TEMPLATE,
  full: FULL_TEMPLATE,
};

export const DEFAULT_TEMPLATE = SIMPLE_TEMPLATE;

export const DEFAULT_SETTINGS: BookmarkSettings = {
  browser: "chrome",
  paths: { chrome: "", firefox: "", safari: "" },
  sqlite3Path: "sqlite3",
  targetFolder: "Bookmarks",
  rootFolder: "",
  folderStructure: "folders",
  intervalMinutes: 0,
  syncOnStartup: true,
  dateFormat: "YYYY-MM-DD",
  templatePreset: "simple",
  customTemplate: FULL_TEMPLATE,
  template: SIMPLE_TEMPLATE,
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

  const PRESETS: TemplatePreset[] = ["simple", "full", "custom"];
  if (!raw?.templatePreset || !PRESETS.includes(raw.templatePreset)) {
    if (raw?.template === SIMPLE_TEMPLATE || !raw?.template) {
      merged.templatePreset = "simple";
    } else if (raw?.template === FULL_TEMPLATE) {
      merged.templatePreset = "full";
    } else {
      merged.templatePreset = "custom";
    }
  } else {
    merged.templatePreset = raw.templatePreset;
  }

  const hasExplicitCustom = typeof raw?.customTemplate === "string" && Boolean(raw.customTemplate.trim());
  if (!hasExplicitCustom) {
    merged.customTemplate =
      merged.templatePreset === "custom" && typeof raw?.template === "string" && raw.template.trim()
        ? raw.template
        : FULL_TEMPLATE;
  }

  if (merged.templatePreset === "simple") {
    merged.template = SIMPLE_TEMPLATE;
  } else if (merged.templatePreset === "full") {
    merged.template = FULL_TEMPLATE;
  } else {
    merged.template = merged.customTemplate;
  }

  if (!merged.dateFormat) merged.dateFormat = DEFAULT_SETTINGS.dateFormat;
  if (!merged.sqlite3Path) merged.sqlite3Path = DEFAULT_SETTINGS.sqlite3Path;
  if (typeof merged.rootFolder !== "string") merged.rootFolder = "";
  const FOLDER_STRUCTURES: FolderStructure[] = ["folders", "flat"];
  if (!FOLDER_STRUCTURES.includes(merged.folderStructure)) merged.folderStructure = "folders";
  return merged;
}

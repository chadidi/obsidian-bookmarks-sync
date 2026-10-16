import type { Logger } from './logger';

export type BrowserType = 'chrome' | 'chromium' | 'firefox' | 'safari';

/**
 * How bookmark notes are laid out in the vault:
 * - "folders": mirror the browser's folder hierarchy as real vault subfolders (default)
 * - "flat": every note lands directly in targetFolder, no subfolders created
 */
export type FolderStructure = 'folders' | 'flat';

export const BROWSER_LABELS: Record<BrowserType, string> = {
  chrome: 'Google Chrome',
  chromium: 'Chromium',
  firefox: 'Mozilla Firefox',
  safari: 'Safari',
};

/** A bookmark normalised across all browsers. */
export interface BookmarkEntry {
  /** Browser-internal identifier (informational only; may be empty). */
  sourceId: string;
  title: string;
  url: string;
  /** Null when the browser does not record it (e.g. Safari). */
  dateAdded: Date | null;
  /** Folder names from the top-level root down to the immediate parent. */
  folderPath: string[];
  browser: BrowserType;
}

export type SyncTrigger = 'manual' | 'periodic' | 'startup';

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  moved: number;
  /** Notes deleted because their bookmark no longer exists in the browser. */
  removed: number;
  unchanged: number;
  /** Reserved for future use (always 0 since sync always overwrites existing notes). */
  skipped: number;
  /** Same URL seen more than once in the browser (first occurrence wins). */
  duplicates: number;
  failed: number;
  durationMs: number;
}

export type TemplatePreset = 'simple' | 'full' | 'custom';

/**
 * A Safari Bookmarks.plist the user selected through the native file dialog. macOS grants read
 * access to just that file for the current session, so the bytes live in memory only.
 */
export interface SafariPick {
  buffer: Buffer;
  /** Absolute path reported by the picker, or "" when the platform does not expose one. */
  path: string;
  /** Base file name, used for display in the settings UI. */
  fileName: string;
}

export interface BookmarkSettings {
  browser: BrowserType;
  /** Per-browser source path. Empty string = use the auto-detected default. */
  paths: Record<BrowserType, string>;
  /** Firefox only: sqlite3 executable used to read places.sqlite. */
  sqlite3Path: string;
  targetFolder: string;
  /**
   * Explicit acknowledgement that lets sync run when targetFolder is empty or "/" (the vault root).
   * Off by default; sync is blocked while it is false and the target is the vault root.
   */
  allowVaultRootTarget: boolean;
  /**
   * Slash-separated path of the browser bookmark folder to sync.
   * Empty string = sync everything. Example: "Bookmarks Bar/Work".
   */
  rootFolder: string;
  /**
   * Whether to mirror the browser folder hierarchy as vault subfolders,
   * or dump every note flat into targetFolder.
   */
  folderStructure: FolderStructure;
  /** 0 disables periodic sync. */
  intervalMinutes: number;
  syncOnStartup: boolean;

  /** moment.js format used by {{date}} and {{synced}} when no explicit format is given. */
  dateFormat?: string;
  templatePreset: TemplatePreset;
  customTemplate: string;
  template: string;
  debug: boolean;
  /** Automatic syncs stay disabled until one manual sync has succeeded. */
  initialSyncDone: boolean;
}

export interface PluginData {
  settings: BookmarkSettings;
  /** Bookmark URL -> vault path of the note that represents it. */
  index: Record<string, string>;
}

/** What the sync engine needs from the plugin instance. */
export interface SyncHost {
  settings: BookmarkSettings;
  index: Record<string, string>;
  log: Logger;
  requestIndexSave(): void;
  /**
   * Session-only bytes of a Safari Bookmarks.plist the user picked via the native file dialog.
   * Null when nothing has been picked this session (macOS clears the grant when Obsidian quits).
   */
  getSafariPickedBuffer?(): Buffer | null;
}

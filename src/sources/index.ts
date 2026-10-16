import type { Logger } from '../logger';
import { resolveSourcePath } from '../paths';
import { BROWSER_LABELS, type BookmarkEntry, type BookmarkSettings } from '../types';
import { readChromeBookmarks } from './chrome';
import { readFirefoxBookmarks } from './firefox';
import { parseSafariBookmarks, readSafariBookmarks } from './safari';

export interface SourceReadResult {
  entries: BookmarkEntry[];
  sourcePath: string;
}

export interface ReadBookmarkOptions {
  /**
   * Session-only bytes of a Safari Bookmarks.plist the user picked via the native file dialog.
   * macOS grants read access to just that file for this session, so it is preferred over the path.
   */
  safariOverride?: Buffer | null;
}

export async function readBookmarks(
  settings: BookmarkSettings,
  log: Logger,
  options: ReadBookmarkOptions = {},
): Promise<SourceReadResult> {
  const browser = settings.browser;
  const sourcePath = resolveSourcePath(browser, settings.paths[browser]);
  log.info(`Reading ${BROWSER_LABELS[browser]} bookmarks from ${sourcePath}`);

  switch (browser) {
    case 'chrome':
      return { entries: await readChromeBookmarks(sourcePath, log), sourcePath };
    case 'firefox':
      return {
        entries: await readFirefoxBookmarks(sourcePath, { sqlite3Path: settings.sqlite3Path }, log),
        sourcePath,
      };
    case 'safari': {
      const override = options.safariOverride;
      if (override) {
        return { entries: parseSafariBookmarks(override, log), sourcePath };
      }
      return { entries: await readSafariBookmarks(sourcePath, log), sourcePath };
    }
  }
}

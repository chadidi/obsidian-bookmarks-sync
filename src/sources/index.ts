import type { Logger } from "../logger";
import { resolveSourcePath } from "../paths";
import { BROWSER_LABELS, type BookmarkEntry, type BookmarkSettings } from "../types";
import { readChromeBookmarks } from "./chrome";
import { readFirefoxBookmarks } from "./firefox";
import { readSafariBookmarks } from "./safari";

export interface SourceReadResult {
  entries: BookmarkEntry[];
  sourcePath: string;
}

export async function readBookmarks(settings: BookmarkSettings, log: Logger): Promise<SourceReadResult> {
  const browser = settings.browser;
  const sourcePath = resolveSourcePath(browser, settings.paths[browser]);
  log.info(`Reading ${BROWSER_LABELS[browser]} bookmarks from ${sourcePath}`);

  switch (browser) {
    case "chrome":
      return { entries: await readChromeBookmarks(sourcePath, log), sourcePath };
    case "firefox":
      return {
        entries: await readFirefoxBookmarks(sourcePath, { sqlite3Path: settings.sqlite3Path }, log),
        sourcePath,
      };
    case "safari":
      return { entries: await readSafariBookmarks(sourcePath, log), sourcePath };
  }
}

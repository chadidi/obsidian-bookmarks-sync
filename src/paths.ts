import * as fs from 'fs';
import { detectBrowsersSync, type BrowserId } from 'browsers-detect';
import { BookmarkSourceError, errorMessage } from './errors';
import { BROWSER_LABELS, type BrowserType } from './types';

/** Resolves one detected profile's bookmark file through the shared detector. */
function detectedBookmarkPath(browser: BrowserId, profileId = ''): string | null {
  const detected = detectBrowsersSync().find((candidate) => candidate.id === browser);
  const profile =
    detected?.profiles.find((candidate) => candidate.id === profileId) ??
    detected?.profiles.find((candidate) => candidate.isDefault) ??
    detected?.profiles[0];
  return profile?.bookmarkPaths[0] ?? null;
}

/** The selected profile's bookmark path. Throws a user-friendly error when it has none. */
export function resolveSourcePath(browser: BrowserType, profileId: string): string {
  const bookmarkPath = detectedBookmarkPath(browser, profileId);
  if (bookmarkPath) return bookmarkPath;
  throw new BookmarkSourceError(
    `No bookmarks file was found for the selected ${BROWSER_LABELS[browser]} profile.`,
  );
}

export interface SourceAccess {
  /** The resolved path, or null when none could be determined for this platform. */
  resolved: string | null;
  /** Whether the path exists on disk. */
  exists: boolean;
  /** Whether the path can actually be read (false when access has not been granted). */
  accessible: boolean;
  /** User-friendly reason when `resolved` is null. */
  error?: string;
}

/** Reads one entry to confirm the OS really lets us in (covers macOS TCC / Full Disk Access). */
function canRead(resolved: string): boolean {
  try {
    if (fs.statSync(resolved).isDirectory()) {
      fs.readdirSync(resolved);
    } else {
      fs.closeSync(fs.openSync(resolved, 'r'));
    }
    return true;
  } catch {
    return false;
  }
}

/** Reports whether the selected browser profile's bookmarks are reachable and readable. */
export function checkSourceAccess(browser: BrowserType, profileId: string): SourceAccess {
  let resolved: string;
  try {
    resolved = resolveSourcePath(browser, profileId);
  } catch (err) {
    return { resolved: null, exists: false, accessible: false, error: errorMessage(err) };
  }
  const exists = fs.existsSync(resolved);
  return { resolved, exists, accessible: exists && canRead(resolved) };
}

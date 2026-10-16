import * as fs from 'fs';
import { BookmarkSourceError } from '../errors';

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Rejects empty values, bookmarklets (javascript:) and Firefox smart folders (place:). */
export function isImportableUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!HAS_SCHEME.test(trimmed)) return false;
  return !/^(javascript|place):/i.test(trimmed);
}

export interface FileErrorHints {
  /** Extra sentence appended to permission errors (e.g. macOS Full Disk Access). */
  permission?: string;
}

/** Reads a file and converts low-level fs errors into messages a user can act on. */
export async function readFileOrThrow(
  filePath: string,
  hints: FileErrorHints = {},
): Promise<Buffer> {
  try {
    return await fs.promises.readFile(filePath);
  } catch (err) {
    throw translateFsError(err, filePath, hints);
  }
}

export function translateFsError(
  err: unknown,
  filePath: string,
  hints: FileErrorHints = {},
): BookmarkSourceError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new BookmarkSourceError(
      `File not found: ${filePath}. Check the path in the plugin settings.`,
      err,
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new BookmarkSourceError(
      `Permission denied reading ${filePath}.${hints.permission ? ' ' + hints.permission : ''}`,
      err,
    );
  }
  if (code === 'EBUSY') {
    return new BookmarkSourceError(
      `${filePath} is locked by another program. It will be retried on the next sync.`,
      err,
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new BookmarkSourceError(`Could not read ${filePath}: ${msg}`, err);
}

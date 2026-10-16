import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '../logger';
import { BookmarkSourceError, errorMessage } from '../errors';
import type { BookmarkEntry } from '../types';
import { isImportableUrl, readFileOrThrow, translateFsError } from './common';
import { decodeMozLz4 } from './lz4';

export interface FirefoxOptions {
  sqlite3Path: string;
}

const ROOT_GUID = 'root________';
const TAGS_GUID = 'tags________';
const ROOT_LABELS: Record<string, string> = {
  menu________: 'Bookmarks Menu',
  toolbar_____: 'Bookmarks Toolbar',
  unfiled_____: 'Other Bookmarks',
  mobile______: 'Mobile Bookmarks',
};
/** In JSON backups the special folders are identified by a `root` property instead of a GUID. */
const BACKUP_ROOT_LABELS: Record<string, string> = {
  bookmarksMenuFolder: 'Bookmarks Menu',
  toolbarFolder: 'Bookmarks Toolbar',
  unfiledBookmarksFolder: 'Other Bookmarks',
  mobileFolder: 'Mobile Bookmarks',
};

/* ------------------------------------------------------------------ */
/* Entry point: SQLite (live) or JSON backup (no extra software)       */
/* ------------------------------------------------------------------ */

export async function readFirefoxBookmarks(
  sourcePath: string,
  options: FirefoxOptions,
  log: Logger,
): Promise<BookmarkEntry[]> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(sourcePath);
  } catch (err) {
    throw translateFsError(err, sourcePath);
  }

  if (stat.isDirectory()) {
    const backup = await newestBackupIn(sourcePath);
    if (backup) return readBackupFile(backup, log);
    const places = path.join(sourcePath, 'places.sqlite');
    if (fs.existsSync(places)) return readPlaces(places, options, log);
    throw new BookmarkSourceError(
      `${sourcePath} contains neither places.sqlite nor bookmarks-*.jsonlz4 backups.`,
    );
  }

  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.jsonlz4') || lower.endsWith('.json')) return readBackupFile(sourcePath, log);
  return readPlaces(sourcePath, options, log);
}

/* ------------------------------------------------------------------ */
/* places.sqlite via the sqlite3 command-line tool                     */
/* ------------------------------------------------------------------ */

interface PlacesRow {
  id: number;
  parent: number;
  type: number; // 1 bookmark, 2 folder, 3 separator
  title: string | null;
  guid: string;
  dateAdded: number | null; // microseconds since the Unix epoch
  url: string | null;
}

const PLACES_QUERY =
  'SELECT b.id AS id, b.parent AS parent, b.type AS type, b.title AS title, b.guid AS guid, ' +
  'b.dateAdded AS dateAdded, p.url AS url ' +
  'FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk;';

function runSqlite(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: 60_000, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(
            new BookmarkSourceError(
              `Could not run "${executable}". Install the sqlite3 command-line tool (or set its full path in ` +
                `the plugin settings), or point the Firefox path at a bookmarkbackups *.jsonlz4 file instead.`,
              err,
            ),
          );
        }
        reject(new BookmarkSourceError(`sqlite3 failed: ${(stderr || err.message).trim()}`, err));
      },
    );
  });
}

async function copyIfExists(from: string, to: string): Promise<void> {
  try {
    await fs.promises.copyFile(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

async function readPlaces(
  dbPath: string,
  options: FirefoxOptions,
  log: Logger,
): Promise<BookmarkEntry[]> {
  // Firefox keeps places.sqlite open in WAL mode. Querying it in place can fail with "database is
  // locked" and would miss uncheckpointed changes. We therefore snapshot the database together
  // with its -wal file into a private temp dir; SQLite replays the WAL when opening the copy.
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-bookmarks-'));
  try {
    const copy = path.join(tmp, 'places.sqlite');
    let stdout = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await copyIfExists(`${dbPath}-wal`, `${copy}-wal`);
        await fs.promises.copyFile(dbPath, copy);
      } catch (err) {
        throw translateFsError(err, dbPath);
      }
      try {
        stdout = await runSqlite(options.sqlite3Path || 'sqlite3', ['-json', copy, PLACES_QUERY]);
        break;
      } catch (err) {
        // A torn snapshot (Firefox checkpointed mid-copy) is rare; retry once.
        if (attempt === 2 || !/malformed|corrupt|not a database/i.test(errorMessage(err)))
          throw err;
        log.warn('places.sqlite snapshot looked inconsistent; retrying once');
        await new Promise((r) => window.setTimeout(r, 500));
      }
    }

    let rows: PlacesRow[] = [];
    if (stdout.trim()) {
      try {
        rows = JSON.parse(stdout) as PlacesRow[];
      } catch (err) {
        throw new BookmarkSourceError(
          'sqlite3 did not return JSON. Your sqlite3 is probably older than 3.33; please update it.',
          err,
        );
      }
    }
    const entries = placesRowsToEntries(rows);
    log.debug(`Firefox (places.sqlite): parsed ${entries.length} bookmarks`);
    return entries;
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function placesRowsToEntries(rows: PlacesRow[]): BookmarkEntry[] {
  const byId = new Map<number, PlacesRow>();
  for (const row of rows) byId.set(row.id, row);

  const cache = new Map<number, string[] | null>();
  const pathOfFolder = (folderId: number): string[] | null => {
    if (cache.has(folderId)) return cache.get(folderId) ?? null;
    const parts: string[] = [];
    let current = byId.get(folderId);
    let result: string[] | null = null;
    for (let depth = 0; current && depth < 64; depth++) {
      if (current.guid === ROOT_GUID) {
        result = parts;
        break;
      }
      if (current.guid === TAGS_GUID) break; // tag "folders" duplicate real bookmarks
      const label = ROOT_LABELS[current.guid] ?? (current.title ?? '').trim();
      if (label) parts.unshift(label);
      current = byId.get(current.parent);
    }
    cache.set(folderId, result);
    return result;
  };

  const out: BookmarkEntry[] = [];
  for (const row of rows) {
    if (row.type !== 1 || !isImportableUrl(row.url)) continue;
    const folderPath = pathOfFolder(row.parent);
    if (folderPath === null) continue;
    out.push({
      sourceId: row.guid,
      title: (row.title ?? '').trim(),
      url: row.url.trim(),
      dateAdded: row.dateAdded ? new Date(row.dateAdded / 1000) : null,
      folderPath,
      browser: 'firefox',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* bookmarkbackups/*.jsonlz4 (or plain .json) - no external tools      */
/* ------------------------------------------------------------------ */

interface BackupNode {
  guid?: string;
  title?: string;
  root?: string;
  type?: string;
  uri?: string;
  dateAdded?: number;
  children?: BackupNode[];
}

async function newestBackupIn(dir: string): Promise<string | null> {
  for (const candidate of [dir, path.join(dir, 'bookmarkbackups')]) {
    let names: string[];
    try {
      names = await fs.promises.readdir(candidate);
    } catch {
      continue;
    }
    const files = await Promise.all(
      names
        .filter((n) => /^bookmarks-.*\.jsonlz4$/i.test(n))
        .map(async (n) => {
          const file = path.join(candidate, n);
          return { file, mtime: (await fs.promises.stat(file)).mtimeMs };
        }),
    );
    files.sort((a, b) => b.mtime - a.mtime);
    if (files[0]) return files[0].file;
  }
  return null;
}

async function readBackupFile(filePath: string, log: Logger): Promise<BookmarkEntry[]> {
  const buffer = await readFileOrThrow(filePath);
  let text: string;
  try {
    text = filePath.toLowerCase().endsWith('.jsonlz4')
      ? Buffer.from(decodeMozLz4(buffer)).toString('utf8')
      : buffer.toString('utf8');
  } catch (err) {
    throw new BookmarkSourceError(`Could not decompress ${filePath}: ${errorMessage(err)}`, err);
  }

  let root: BackupNode;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, '')) as BackupNode;
  } catch (err) {
    throw new BookmarkSourceError(`${filePath} does not contain valid bookmark JSON.`, err);
  }

  const out: BookmarkEntry[] = [];
  for (const top of root.children ?? []) {
    if (top.root === 'tagsFolder' || top.guid === TAGS_GUID) continue;
    const label =
      BACKUP_ROOT_LABELS[top.root ?? ''] ?? ROOT_LABELS[top.guid ?? ''] ?? (top.title ?? '').trim();
    walkBackup(top.children ?? [], label ? [label] : [], out);
  }
  log.debug(`Firefox (backup ${path.basename(filePath)}): parsed ${out.length} bookmarks`);
  return out;
}

function walkBackup(nodes: BackupNode[], trail: string[], out: BookmarkEntry[]): void {
  for (const node of nodes) {
    if (node.type === 'text/x-moz-place') {
      if (!isImportableUrl(node.uri)) continue;
      out.push({
        sourceId: node.guid ?? '',
        title: (node.title ?? '').trim(),
        url: node.uri.trim(),
        dateAdded: node.dateAdded ? new Date(node.dateAdded / 1000) : null,
        folderPath: trail,
        browser: 'firefox',
      });
    } else if (node.type === 'text/x-moz-place-container') {
      const name = (node.title ?? '').trim();
      walkBackup(node.children ?? [], name ? [...trail, name] : trail, out);
    }
  }
}

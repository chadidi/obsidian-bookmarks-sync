import bplist from 'bplist-parser';
import type { Logger } from '../logger';
import { BookmarkSourceError, errorMessage } from '../errors';
import type { BookmarkEntry } from '../types';
import { isImportableUrl, readFileOrThrow } from './common';

type PlistDict = Record<string, unknown>;

const FULL_DISK_ACCESS_HINT =
  'macOS protects ~/Library/Safari. Grant Obsidian access in System Settings → Privacy & Security → ' +
  'Full Disk Access, then restart Obsidian.';

const FOLDER_LABELS: Record<string, string> = {
  BookmarksBar: 'Favorites',
  BookmarksMenu: 'Bookmarks Menu',
};
const READING_LIST_TITLE = 'com.apple.ReadingList';

function isDict(value: unknown): value is PlistDict {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** Minimal XML plist reader (Safari's file is binary, but users may point at an exported XML copy). */
function parseXmlPlistNode(el: Element): unknown {
  switch (el.tagName) {
    case 'dict': {
      const obj: PlistDict = {};
      const kids = Array.from(el.children);
      for (let i = 0; i + 1 < kids.length; i += 2) {
        const keyEl = kids[i];
        const valEl = kids[i + 1];
        if (keyEl && valEl) {
          obj[keyEl.textContent ?? ''] = parseXmlPlistNode(valEl);
        }
      }
      return obj;
    }
    case 'array':
      return Array.from(el.children).map(parseXmlPlistNode);
    case 'string':
      return el.textContent ?? '';
    case 'integer':
      return parseInt(el.textContent ?? '0', 10);
    case 'real':
      return parseFloat(el.textContent ?? '0');
    case 'true':
      return true;
    case 'false':
      return false;
    case 'date':
      return new Date(el.textContent ?? '');
    default:
      return el.textContent ?? null; // <data> etc.
  }
}

function parseXmlPlist(xml: string): PlistDict {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML plist is malformed');
  const root = doc.querySelector('plist > dict');
  if (!root) throw new Error('XML plist has no root <dict>');
  const parsed = parseXmlPlistNode(root);
  if (!isDict(parsed)) throw new Error('XML plist root is not a dictionary');
  return parsed;
}

function parsePlist(buffer: Buffer): PlistDict {
  if (buffer.subarray(0, 6).toString('latin1') === 'bplist') {
    // bplist-parser caps files at 32 768 objects by default; a big bookmark library exceeds that.
    bplist.maxObjectCount = 50_000_000;
    const parsed = bplist.parseBuffer(buffer);
    const root = parsed[0];
    if (!isDict(root)) throw new Error('binary plist root is not a dictionary');
    return root;
  }
  return parseXmlPlist(buffer.toString('utf8'));
}

function walk(node: PlistDict, trail: string[], out: BookmarkEntry[]): void {
  const type = node.WebBookmarkType;

  if (type === 'WebBookmarkTypeList') {
    const rawTitle = typeof node.Title === 'string' ? node.Title : '';
    if (rawTitle === READING_LIST_TITLE) return; // Reading List is not a bookmark folder
    const title = FOLDER_LABELS[rawTitle] ?? rawTitle;
    const next = title ? [...trail, title] : trail;
    if (Array.isArray(node.Children)) {
      for (const child of node.Children) if (isDict(child)) walk(child, next, out);
    }
    return;
  }

  if (type === 'WebBookmarkTypeLeaf') {
    const url = node.URLString;
    if (!isImportableUrl(url)) return;
    const uri = isDict(node.URIDictionary) ? node.URIDictionary : {};
    const title =
      typeof uri.title === 'string' ? uri.title : typeof node.Title === 'string' ? node.Title : '';
    out.push({
      sourceId: typeof node.WebBookmarkUUID === 'string' ? node.WebBookmarkUUID : '',
      title: title.trim(),
      url: url.trim(),
      dateAdded: null, // Safari does not store a creation date for regular bookmarks
      folderPath: trail,
      browser: 'safari',
    });
  }
  // WebBookmarkTypeProxy (History, etc.) is ignored.
}

export async function readSafariBookmarks(filePath: string, log: Logger): Promise<BookmarkEntry[]> {
  const buffer = await readFileOrThrow(filePath, { permission: FULL_DISK_ACCESS_HINT });

  let root: PlistDict;
  try {
    root = parsePlist(buffer);
  } catch (err) {
    throw new BookmarkSourceError(
      `Could not parse ${filePath} as a Safari Bookmarks.plist: ${errorMessage(err)}`,
      err,
    );
  }

  const out: BookmarkEntry[] = [];
  walk(root, [], out);
  log.debug(`Safari: parsed ${out.length} bookmarks`);
  return out;
}

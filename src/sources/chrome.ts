import type { Logger } from "../logger";
import { BookmarkSourceError } from "../errors";
import type { BookmarkEntry } from "../types";
import { isImportableUrl, readFileOrThrow } from "./common";

interface ChromeNode {
  id?: string;
  guid?: string;
  name?: string;
  type?: string;
  url?: string;
  /** Microseconds since 1601-01-01 (WebKit/Windows FILETIME epoch), as a string. */
  date_added?: string;
  children?: ChromeNode[];
}

const ROOT_LABELS: Record<string, string> = {
  bookmark_bar: "Bookmarks Bar",
  other: "Other Bookmarks",
  synced: "Mobile Bookmarks",
};

const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000;

function webkitToDate(value: string | undefined): Date | null {
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return null;
  const ms = micros / 1000 - WEBKIT_EPOCH_OFFSET_MS;
  return ms > 0 ? new Date(ms) : null;
}

function walk(nodes: ChromeNode[], trail: string[], out: BookmarkEntry[]): void {
  for (const node of nodes) {
    if (node.type === "url") {
      if (!isImportableUrl(node.url)) continue;
      out.push({
        sourceId: node.guid ?? node.id ?? "",
        title: (node.name ?? "").trim(),
        url: node.url.trim(),
        dateAdded: webkitToDate(node.date_added),
        folderPath: trail,
        browser: "chrome",
      });
    } else if (Array.isArray(node.children)) {
      const name = (node.name ?? "").trim();
      walk(node.children, name ? [...trail, name] : trail, out);
    }
  }
}

export async function readChromeBookmarks(filePath: string, log: Logger): Promise<BookmarkEntry[]> {
  const buffer = await readFileOrThrow(filePath);

  let doc: { roots?: Record<string, unknown> };
  try {
    doc = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new BookmarkSourceError(
      `${filePath} is not valid JSON. Is it really a Chrome/Chromium "Bookmarks" file?`,
      err,
    );
  }
  if (!doc.roots || typeof doc.roots !== "object") {
    throw new BookmarkSourceError(`${filePath} has no "roots" section; unsupported Bookmarks file layout.`);
  }

  const out: BookmarkEntry[] = [];
  for (const [key, value] of Object.entries(doc.roots)) {
    if (typeof value !== "object" || value === null) continue; // e.g. sync_transaction_version
    const root = value as ChromeNode;
    walk(root.children ?? [], [ROOT_LABELS[key] ?? (root.name ?? key)], out);
  }
  log.debug(`Chrome: parsed ${out.length} bookmarks`);
  return out;
}

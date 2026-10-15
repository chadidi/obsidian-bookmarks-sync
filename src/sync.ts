import { normalizePath, TFile, TFolder, type App } from "obsidian";
import { errorMessage } from "./errors";
import type { Logger } from "./logger";
import { DEFAULT_TEMPLATE } from "./settings";
import { readBookmarks } from "./sources";
import { findUnknownPlaceholders, renderTemplate, type DateFormatter } from "./template";
import type { BookmarkEntry, SyncHost, SyncResult, SyncTrigger } from "./types";
import { hasOwn, joinVaultPath, sanitizeFileName, sanitizeFolderName, shortHash, yieldToUi } from "./utils";

/** Hand control back to the UI thread every N bookmarks so a large import never freezes Obsidian. */
const YIELD_EVERY = 25;

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

interface Target {
  path: string;
  /** Existing note for this bookmark, or null if a new one must be created at `path`. */
  file: TFile | null;
}

/**
 * Parses a slash-separated folder path string into an array of trimmed, non-empty segments.
 * e.g. "Bookmarks Bar/Work" → ["Bookmarks Bar", "Work"]
 */
function parseRootFolderSegments(rootFolder: string): string[] {
  return rootFolder
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * When `rootFolder` is configured, keeps only entries whose `folderPath` starts with
 * the given segments (case-insensitive). Empty `rootFolder` returns all entries unchanged.
 */
function filterByRootFolder(entries: BookmarkEntry[], rootFolder: string, log: Logger): BookmarkEntry[] {
  const segments = parseRootFolderSegments(rootFolder);
  if (segments.length === 0) return entries;

  const lower = segments.map((s) => s.toLowerCase());
  const filtered = entries.filter((e) => {
    if (e.folderPath.length < lower.length) return false;
    return lower.every((seg, i) => e.folderPath[i]?.toLowerCase() === seg);
  });

  log.debug(`Root-folder filter "${rootFolder}": ${entries.length} → ${filtered.length} bookmarks`);
  return filtered;
}

export class SyncEngine {
  private running = false;

  constructor(
    private readonly app: App,
    private readonly host: SyncHost,
    private readonly formatDate: DateFormatter,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Returns null if another sync is already in progress. Throws on source-level failures. */
  async run(trigger: SyncTrigger): Promise<SyncResult | null> {
    if (this.running) {
      this.host.log.warn(`Sync (${trigger}) skipped: a previous sync is still running`);
      return null;
    }
    this.running = true;
    const started = Date.now();
    try {
      const { entries } = await readBookmarks(this.host.settings, this.host.log);
      const filtered = filterByRootFolder(entries, this.host.settings.rootFolder, this.host.log);
      const result = await this.apply(filtered);
      result.durationMs = Date.now() - started;
      this.host.log.info(`Sync (${trigger}) finished`, result);
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Keeps the index in step when the user renames/moves a bookmark note or its folder. */
  handleRename(oldPath: string, newPath: string, isFolder: boolean): void {
    const index = this.host.index;
    let changed = false;
    for (const key of Object.keys(index)) {
      const p = index[key];
      if (!p) continue;
      if (p === oldPath) {
        index[key] = newPath;
        changed = true;
      } else if (isFolder && p.startsWith(`${oldPath}/`)) {
        index[key] = newPath + p.slice(oldPath.length);
        changed = true;
      }
    }
    if (changed) this.host.requestIndexSave();
  }

  /* -------------------------------------------------------------- */

  private async apply(entries: BookmarkEntry[]): Promise<SyncResult> {
    const { settings, log } = this.host;
    const result: SyncResult = {
      total: entries.length, created: 0, updated: 0, unchanged: 0,
      skipped: 0, duplicates: 0, failed: 0, durationMs: 0,
    };

    const folder = normalizePath(settings.targetFolder.trim() || "/");
    await this.ensureFolder(folder);

    const template = settings.template.trim() ? settings.template : DEFAULT_TEMPLATE;
    const unknown = findUnknownPlaceholders(template);
    if (unknown.length) log.warn(`Template has unknown placeholders (left as-is): ${unknown.join(", ")}`);

    // path -> bookmark key, so we never hand one note to two different bookmarks.
    const owner = new Map<string, string>();
    for (const [key, p] of Object.entries(this.host.index)) owner.set(p, key);

    // Pre-compute root folder segments once so syncEntry can strip them.
    const rootSegments = parseRootFolderSegments(settings.rootFolder);

    const seen = new Set<string>();
    const syncedAt = new Date();
    let handled = 0;

    for (const entry of entries) {
      if (++handled % YIELD_EVERY === 0) await yieldToUi();

      const key = entry.url.trim();
      if (!key) continue;
      if (seen.has(key)) {
        result.duplicates++;
        continue;
      }
      seen.add(key);

      try {
        await this.syncEntry(entry, key, folder, rootSegments, template, syncedAt, owner, result);
      } catch (err) {
        // Error boundary: one bad bookmark must not abort the whole sync.
        result.failed++;
        log.error(`Failed to sync "${entry.title}" <${key}>: ${errorMessage(err)}`, err);
      }
    }

    this.pruneIndex();
    this.host.requestIndexSave();
    return result;
  }

  private async syncEntry(
    entry: BookmarkEntry,
    key: string,
    baseFolder: string,
    rootSegments: string[],
    template: string,
    syncedAt: Date,
    owner: Map<string, string>,
    result: SyncResult,
  ): Promise<void> {
    const { settings, index } = this.host;
    const vault = this.app.vault;

    // Compute the destination folder for this entry.
    const noteFolder = this.resolveNoteFolder(entry, baseFolder, rootSegments);
    if (noteFolder !== baseFolder) await this.ensureFolder(noteFolder);

    const target = await this.resolveTarget(entry, key, noteFolder, owner);

    if (target.file) {
      index[key] = target.path;
      owner.set(target.path, key);

      // 1-way sync: always overwrite with the latest template render.
      const content = this.render(entry, template, syncedAt);
      let changed = false;
      // vault.process is an atomic read-modify-write, so we never clobber a concurrent edit.
      await vault.process(target.file, (current) => {
        if (current === content) return current;
        changed = true;
        return content;
      });
      if (changed) result.updated++;
      else result.unchanged++;
      return;
    }

    await vault.create(target.path, this.render(entry, template, syncedAt));
    index[key] = target.path;
    owner.set(target.path, key);
    result.created++;
  }

  /**
   * When folderStructure is "folders", compute the vault subfolder that mirrors
   * the browser folder hierarchy. The rootFolder segments are stripped from the
   * front of entry.folderPath so they don't appear as extra nesting.
   *
   * e.g. baseFolder="Bookmarks", rootSegments=["Bookmarks Bar"],
   *      entry.folderPath=["Bookmarks Bar","Work"] → "Bookmarks/Work"
   */
  private resolveNoteFolder(entry: BookmarkEntry, baseFolder: string, rootSegments: string[]): string {
    const { settings } = this.host;
    if (settings.folderStructure !== "folders") return baseFolder;

    // Strip the rootFolder prefix (already validated by filterByRootFolder).
    const subPath = entry.folderPath.slice(rootSegments.length);
    if (subPath.length === 0) return baseFolder;

    const sanitized = subPath.map((s) => sanitizeFolderName(s)).join("/");
    return normalizePath(`${baseFolder}/${sanitized}`);
  }

  private render(entry: BookmarkEntry, template: string, syncedAt: Date): string {
    const { settings } = this.host;
    return withTrailingNewline(
      renderTemplate(
        template,
        {
          title: entry.title || fallbackTitle(entry.url),
          url: entry.url,
          date: entry.dateAdded ?? syncedAt,
          synced: syncedAt,
          folderPath: entry.folderPath,
          browser: entry.browser,
        },
        this.formatDate,
        settings.dateFormat,
      ),
    );
  }

  /**
   * Decides which note represents a bookmark:
   *  1. the note recorded in the index (survives renames, see handleRename);
   *  2. otherwise a note at the deterministic "<title>.md" path that already contains the URL (adopted);
   *  3. otherwise a free path - "<title>.md", then "<title> (hash).md" if the name is taken.
   */
  private async resolveTarget(
    entry: BookmarkEntry,
    key: string,
    folder: string,
    owner: Map<string, string>,
  ): Promise<Target> {
    const vault = this.app.vault;
    const { index } = this.host;

    if (hasOwn(index, key)) {
      const tracked = index[key];
      if (tracked) {
        const file = vault.getAbstractFileByPath(tracked);
        if (file instanceof TFile) return { path: tracked, file };
        delete index[key]; // note was deleted: treat the bookmark as new again
        if (owner.get(tracked) === key) owner.delete(tracked);
      } else {
        delete index[key];
      }
    }

    const base = sanitizeFileName(entry.title || fallbackTitle(entry.url));
    const names = [base, `${base} (${shortHash(key, 6)})`, `${base} (${shortHash(key, 12)})`];

    for (const name of names) {
      const candidate = normalizePath(joinVaultPath(folder, `${name}.md`));
      const claimedBy = owner.get(candidate);
      if (claimedBy !== undefined && claimedBy !== key) continue;

      const existing = vault.getAbstractFileByPath(candidate);
      if (existing instanceof TFile) {
        const content = await vault.cachedRead(existing);
        if (content.includes(key)) return { path: candidate, file: existing }; // adopt
        continue; // unrelated note with the same name
      }
      if (existing) continue; // a folder with that name

      // Not in Obsidian's file tree, but may exist on disk (case-insensitive file systems, hidden files).
      if (await vault.adapter.exists(candidate)) continue;
      return { path: candidate, file: null };
    }
    throw new Error(`no free file name found for "${entry.title}"`);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (folder === "" || folder === "/") return;
    const vault = this.app.vault;
    const existing = vault.getAbstractFileByPath(folder);
    if (existing instanceof TFolder) return;
    if (existing) throw new Error(`"${folder}" exists but is a file, not a folder`);
    try {
      await vault.createFolder(folder);
    } catch (err) {
      // Lost a race with another creator? Fine if the folder is there now.
      if (!(vault.getAbstractFileByPath(folder) instanceof TFolder)) throw err;
    }
  }

  private pruneIndex(): void {
    const index = this.host.index;
    for (const key of Object.keys(index)) {
      const p = index[key];
      if (!p || !(this.app.vault.getAbstractFileByPath(p) instanceof TFile)) delete index[key];
    }
  }
}

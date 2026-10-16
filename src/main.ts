import { Notice, Plugin, TFolder, addIcon, debounce, moment, setIcon } from 'obsidian';
import { errorMessage } from './errors';
import { Logger } from './logger';
import { normalizeSettings } from './settings';
import { BookmarkSettingTab } from './settings-tab';
import { SyncEngine } from './sync';
import type {
  BookmarkSettings,
  PluginData,
  SafariPick,
  SyncHost,
  SyncResult,
  SyncTrigger,
} from './types';

// Obsidian re-exports moment.js, but its typings are not directly callable under esModuleInterop.
const formatWithMoment = (date: Date, format: string): string =>
  (moment as unknown as (d: Date) => { format(f: string): string })(date).format(format);

export default class BookmarksSyncPlugin extends Plugin implements SyncHost {
  settings!: BookmarkSettings;
  index: Record<string, string> = {};
  readonly log = new Logger(() => this.settings?.debug ?? false);

  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private lastAutomaticError = '';
  private readonly saveIndexSoon = debounce(() => void this.persist(), 1000, true);
  /**
   * Safari Bookmarks.plist the user picked through the native dialog. macOS only grants access for
   * the current session, so this lives in memory and is intentionally never persisted.
   */
  private safariPick: SafariPick | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.engine = new SyncEngine(this.app, this, formatWithMoment);

    // Register the exact current Lucide bookmark SVG so it looks identical to lucide.dev/icons/bookmark.
    // Obsidian bundles an older Lucide version; addIcon() lets us ship the up-to-date path.
    // The path is authored for a 24×24 canvas; scale(4.167) maps it to Obsidian's required 100×100 viewBox.
    addIcon(
      'bookmarks-sync',
      `<g transform="scale(4.167)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>
      </g>`,
    );

    // Manual sync: ribbon button + command palette.
    this.addRibbonIcon('bookmarks-sync', 'Sync bookmarks now', () => void this.syncNow('manual'));
    this.addCommand({
      id: 'sync-now',
      name: 'Sync bookmarks now',
      icon: 'bookmarks-sync',
      callback: () => void this.syncNow('manual'),
    });

    const settingTab = new BookmarkSettingTab(this.app, this);
    this.addSettingTab(settingTab);
    // Prepend the icon so it appears on the left, matching all other settings sidebar items.
    // setIcon() appends to the element, so we create a dedicated span, prepend it, then set the icon.
    const navEl = (settingTab as unknown as { navEl?: HTMLElement }).navEl;
    if (navEl) {
      const iconEl = navEl.createSpan({ cls: 'bb-settings-nav-icon' });
      navEl.prepend(iconEl);
      setIcon(iconEl, 'bookmarks-sync');
    }

    // Keep the bookmark -> note index valid when the user renames or moves notes.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.engine.handleRename(oldPath, file.path, file instanceof TFolder);
      }),
    );

    this.schedulePeriodicSync();
    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => void this.syncNow('startup'));
    }
    this.log.debug('Plugin loaded');
  }

  onunload(): void {
    // The interval and vault events are registered via register*(), so Obsidian removes them for us.
    void this.persist();
    this.log.debug('Plugin unloaded');
  }

  /* ------------------------------------------------------------------ */
  /* Scheduling                                                          */
  /* ------------------------------------------------------------------ */

  /** (Re)creates the background timer from the current settings. Safe to call repeatedly. */
  schedulePeriodicSync(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    const minutes = this.settings.intervalMinutes;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      this.log.info('Periodic sync is disabled');
      return;
    }
    const ms = minutes * 60 * 1000;
    this.intervalId = this.registerInterval(
      window.setInterval(() => void this.syncNow('periodic'), ms),
    );
    this.log.info(`Periodic sync scheduled every ${minutes} minute(s)`);
  }

  /* ------------------------------------------------------------------ */
  /* Sync entry point with error boundary                                */
  /* ------------------------------------------------------------------ */

  async syncNow(trigger: SyncTrigger): Promise<void> {
    const manual = trigger === 'manual';

    if (!manual && !this.settings.initialSyncDone) {
      this.log.info(`Automatic (${trigger}) sync skipped: run one manual sync first`);
      return;
    }

    const progress = manual ? new Notice('Syncing bookmarks…', 0) : null;
    try {
      const result = await this.engine.run(trigger);
      if (!result) {
        if (manual) new Notice('A bookmark sync is already running.');
        return;
      }
      this.lastAutomaticError = '';
      if (!this.settings.initialSyncDone) {
        this.settings.initialSyncDone = true;
        await this.saveSettings();
      }
      if (manual) new Notice(this.summarize(result), 6000);
    } catch (err) {
      const message = errorMessage(err);
      this.log.error(`Sync (${trigger}) failed: ${message}`, err);
      // Don't repeat the same background error as a popup every interval.
      if (manual || message !== this.lastAutomaticError) {
        new Notice(`Bookmark sync failed: ${message}`, 10000);
      }
      if (!manual) this.lastAutomaticError = message;
    } finally {
      progress?.hide();
    }
  }

  private summarize(r: SyncResult): string {
    const parts = [`${r.created} created`];
    if (r.updated) parts.push(`${r.updated} updated`);
    if (r.moved) parts.push(`${r.moved} moved`);
    if (r.removed) parts.push(`${r.removed} removed`);
    if (r.skipped) parts.push(`${r.skipped} existing skipped`);
    if (r.unchanged) parts.push(`${r.unchanged} unchanged`);
    if (r.duplicates) parts.push(`${r.duplicates} duplicate URLs ignored`);
    if (r.failed) parts.push(`${r.failed} failed (see console)`);
    return `Bookmark sync complete: ${parts.join(', ')} (${(r.durationMs / 1000).toFixed(1)}s).`;
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginData> | null;
    this.settings = normalizeSettings(raw?.settings);
    this.index = raw?.index && typeof raw.index === 'object' ? { ...raw.index } : {};
  }

  private async persist(): Promise<void> {
    try {
      const data: PluginData = { settings: this.settings, index: this.index };
      await this.saveData(data);
    } catch (err) {
      this.log.error('Could not save plugin data', err);
    }
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  requestIndexSave(): void {
    this.saveIndexSoon();
  }

  /** The in-memory Safari pick for this session, if the user has chosen a Bookmarks.plist. */
  getSafariPick(): SafariPick | null {
    return this.safariPick;
  }

  setSafariPick(pick: SafariPick | null): void {
    this.safariPick = pick;
  }

  getSafariPickedBuffer(): Buffer | null {
    return this.safariPick?.buffer ?? null;
  }
}

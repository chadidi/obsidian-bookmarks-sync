import { Notice, Plugin, TFolder, debounce, moment } from "obsidian";
import { errorMessage } from "./errors";
import { Logger } from "./logger";
import { normalizeSettings } from "./settings";
import { BookmarkSettingTab } from "./settings-tab";
import { SyncEngine } from "./sync";
import type { BookmarkSettings, PluginData, SyncHost, SyncResult, SyncTrigger } from "./types";

// Obsidian re-exports moment.js, but its typings are not directly callable under esModuleInterop.
const formatWithMoment = (date: Date, format: string): string =>
  (moment as unknown as (d: Date) => { format(f: string): string })(date).format(format);

export default class BrowserBookmarksPlugin extends Plugin implements SyncHost {
  settings!: BookmarkSettings;
  index: Record<string, string> = {};
  readonly log = new Logger(() => this.settings?.debug ?? false);

  private engine!: SyncEngine;
  private intervalId: number | null = null;
  private lastAutomaticError = "";
  private readonly saveIndexSoon = debounce(() => void this.persist(), 1000, true);

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.engine = new SyncEngine(this.app, this, formatWithMoment);

    // Manual sync: ribbon button + command palette.
    this.addRibbonIcon("bookmark", "Sync browser bookmarks now", () => void this.syncNow("manual"));
    this.addCommand({
      id: "sync-now",
      name: "Sync browser bookmarks now",
      callback: () => void this.syncNow("manual"),
    });

    this.addSettingTab(new BookmarkSettingTab(this.app, this));

    // Keep the bookmark -> note index valid when the user renames or moves notes.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.engine.handleRename(oldPath, file.path, file instanceof TFolder);
      }),
    );

    this.schedulePeriodicSync();
    if (this.settings.syncOnStartup) {
      this.app.workspace.onLayoutReady(() => void this.syncNow("startup"));
    }
    this.log.debug("Plugin loaded");
  }

  onunload(): void {
    // The interval and vault events are registered via register*(), so Obsidian removes them for us.
    void this.persist();
    this.log.debug("Plugin unloaded");
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
      this.log.info("Periodic sync is disabled");
      return;
    }
    const ms = minutes * 60 * 1000;
    this.intervalId = this.registerInterval(window.setInterval(() => void this.syncNow("periodic"), ms));
    this.log.info(`Periodic sync scheduled every ${minutes} minute(s)`);
  }

  /* ------------------------------------------------------------------ */
  /* Sync entry point with error boundary                                */
  /* ------------------------------------------------------------------ */

  async syncNow(trigger: SyncTrigger): Promise<void> {
    const manual = trigger === "manual";

    if (!manual && !this.settings.initialSyncDone) {
      this.log.info(`Automatic (${trigger}) sync skipped: run one manual sync first`);
      return;
    }

    const progress = manual ? new Notice("Syncing browser bookmarks…", 0) : null;
    try {
      const result = await this.engine.run(trigger);
      if (!result) {
        if (manual) new Notice("A bookmark sync is already running.");
        return;
      }
      this.lastAutomaticError = "";
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
    if (r.skipped) parts.push(`${r.skipped} existing skipped`);
    if (r.unchanged) parts.push(`${r.unchanged} unchanged`);
    if (r.duplicates) parts.push(`${r.duplicates} duplicate URLs ignored`);
    if (r.failed) parts.push(`${r.failed} failed (see console)`);
    return `Bookmark sync complete: ${parts.join(", ")} (${(r.durationMs / 1000).toFixed(1)}s).`;
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  private async loadPluginData(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginData> | null;
    this.settings = normalizeSettings(raw?.settings);
    this.index = raw?.index && typeof raw.index === "object" ? { ...raw.index } : {};
  }

  private async persist(): Promise<void> {
    try {
      const data: PluginData = { settings: this.settings, index: this.index };
      await this.saveData(data);
    } catch (err) {
      this.log.error("Could not save plugin data", err);
    }
  }

  async saveSettings(): Promise<void> {
    await this.persist();
  }

  requestIndexSave(): void {
    this.saveIndexSoon();
  }
}

import * as fs from "fs";
import { App, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import type BrowserBookmarksPlugin from "./main";
import { defaultBrowserPath, resolveSourcePath } from "./paths";
import { DEFAULT_TEMPLATE } from "./settings";
import { findUnknownPlaceholders } from "./template";
import { BROWSER_LABELS, type BrowserType } from "./types";

const PATH_HELP: Record<BrowserType, string> = {
  chrome:
    'The Chrome/Chromium "Bookmarks" JSON file. For other profiles or Chromium browsers (Edge, Brave...) enter their Bookmarks file here.',
  firefox:
    "Either places.sqlite (live data; needs the sqlite3 command-line tool) or a bookmarkbackups *.jsonlz4 file / folder " +
    "(no extra software, but only as fresh as Firefox's last daily backup).",
  safari:
    "Safari's binary Bookmarks.plist (macOS only). Obsidian needs Full Disk Access in System Settings → Privacy & Security.",
};

export class BookmarkSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BrowserBookmarksPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    const save = debounce(() => void this.plugin.saveSettings(), 500, true);
    const reschedule = debounce(() => this.plugin.schedulePeriodicSync(), 800, true);

    /* ---------------- Source ---------------- */
    new Setting(containerEl).setName("Source").setHeading();

    new Setting(containerEl)
      .setName("Browser")
      .setDesc("Which browser's bookmarks to import.")
      .addDropdown((dd) =>
        dd
          .addOptions({ chrome: BROWSER_LABELS.chrome, firefox: BROWSER_LABELS.firefox, safari: `${BROWSER_LABELS.safari} (macOS)` })
          .setValue(settings.browser)
          .onChange(async (value) => {
            settings.browser = value as BrowserType;
            await this.plugin.saveSettings();
            this.display(); // path help and extra fields depend on the browser
          }),
      );

    const browser = settings.browser;
    const pathSetting = new Setting(containerEl)
      .setName("Bookmarks file path")
      .setDesc(this.pathDescription(browser, settings.paths[browser]))
      .addText((text) => {
        text
          .setPlaceholder(defaultBrowserPath(browser) || "No default for this platform")
          .setValue(settings.paths[browser])
          .onChange((value) => {
            settings.paths[browser] = value.trim();
            save();
          });
        text.inputEl.addClass("bb-wide-input");
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Use the detected default")
          .onClick(async () => {
            settings.paths[browser] = "";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    pathSetting.descEl.addClass("bb-path-desc");

    if (browser === "firefox") {
      new Setting(containerEl)
        .setName("sqlite3 executable")
        .setDesc("Only used when the path above points to places.sqlite. Leave as 'sqlite3' if it is on your PATH.")
        .addText((text) =>
          text
            .setPlaceholder("sqlite3")
            .setValue(settings.sqlite3Path)
            .onChange((value) => {
              settings.sqlite3Path = value.trim() || "sqlite3";
              save();
            }),
        );
    }

    /* ---------------- Output ---------------- */
    new Setting(containerEl).setName("Output").setHeading();

    new Setting(containerEl)
      .setName("Target folder")
      .setDesc("Vault folder for the bookmark notes. It is created if it does not exist.")
      .addText((text) =>
        text
          .setPlaceholder("Bookmarks")
          .setValue(settings.targetFolder)
          .onChange((value) => {
            settings.targetFolder = value.trim();
            save();
          }),
      );

    const modeSetting = new Setting(containerEl).setName("Apply templates to existing bookmarks");
    const describeMode = (apply: boolean) =>
      modeSetting.setDesc(
        apply
          ? "On: notes that already exist are overwritten with the latest template on every sync. Manual edits to those notes are lost."
          : "Off: only sync new bookmarks. Notes that already exist (found by their recorded link or by containing the URL) are never touched.",
      );
    describeMode(settings.applyToExisting);
    modeSetting.addToggle((toggle) =>
      toggle.setValue(settings.applyToExisting).onChange(async (value) => {
        settings.applyToExisting = value;
        describeMode(value);
        await this.plugin.saveSettings();
      }),
    );

    /* ---------------- Automation ---------------- */
    new Setting(containerEl).setName("Automation").setHeading();

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc(
        "How often to sync in the background. Use 0 to disable. Automatic syncs only start after you have " +
          "run one manual sync successfully, so nothing is imported by surprise.",
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text
          .setPlaceholder("60")
          .setValue(String(settings.intervalMinutes))
          .onChange((value) => {
            const minutes = Number(value);
            if (!Number.isFinite(minutes) || minutes < 0) return;
            settings.intervalMinutes = Math.min(Math.floor(minutes), 10080);
            save();
            reschedule();
          });
      });

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Run a sync once Obsidian has finished loading.")
      .addToggle((toggle) =>
        toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
          settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Run a sync immediately.")
      .addButton((btn) =>
        btn
          .setButtonText("Sync bookmarks")
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await this.plugin.syncNow("manual");
            } finally {
              btn.setDisabled(false);
            }
          }),
      );

    /* ---------------- Template ---------------- */
    new Setting(containerEl).setName("Note template").setHeading();

    const templateSetting = new Setting(containerEl)
      .setName("Template")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Placeholders: ");
          ["{{title}}", "{{url}}", "{{date}}", "{{folder_path}}"].forEach((p, i) => {
            if (i) frag.appendText(", ");
            frag.createEl("code", { text: p });
          });
          frag.appendText(". Also: ");
          ["{{folder}}", "{{domain}}", "{{browser}}", "{{synced}}"].forEach((p, i) => {
            if (i) frag.appendText(", ");
            frag.createEl("code", { text: p });
          });
          frag.createEl("br");
          frag.appendText("Date placeholders accept a moment.js format, e.g. ");
          frag.createEl("code", { text: "{{date:YYYY-MM-DD HH:mm}}" });
          frag.appendText(". Add ");
          frag.createEl("code", { text: "|yaml" });
          frag.appendText(" (e.g. ");
          frag.createEl("code", { text: "{{title|yaml}}" });
          frag.appendText(") to quote a value safely inside front matter.");
        }),
      );
    templateSetting.settingEl.addClass("bb-template-setting");

    const warningEl = containerEl.createDiv({ cls: "setting-item-description bb-warning" });
    const refreshWarning = () => {
      const unknown = findUnknownPlaceholders(settings.template);
      warningEl.setText(unknown.length ? `Unknown placeholders (will be left as-is): ${unknown.join(", ")}` : "");
    };

    templateSetting.addTextArea((area) => {
      area.setValue(settings.template).onChange((value) => {
        settings.template = value;
        refreshWarning();
        save();
      });
      area.inputEl.rows = 16;
      area.inputEl.spellcheck = false;
    });
    refreshWarning();

    new Setting(containerEl)
      .setName("Default date format")
      .setDesc("moment.js format used by {{date}} and {{synced}} when they have no explicit format. {{date}} is the day the bookmark was added in the browser (the sync date if the browser doesn't record it, as in Safari).")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(settings.dateFormat)
          .onChange((value) => {
            settings.dateFormat = value.trim() || "YYYY-MM-DD";
            save();
          }),
      );

    new Setting(containerEl)
      .setName("Reset template")
      .setDesc("Restore the built-in template. Your current template will be replaced.")
      .addButton((btn) =>
        btn.setButtonText("Reset").onClick(async () => {
          settings.template = DEFAULT_TEMPLATE;
          await this.plugin.saveSettings();
          this.display();
          new Notice("Template reset to default.");
        }),
      );

    /* ---------------- Diagnostics ---------------- */
    new Setting(containerEl).setName("Diagnostics").setHeading();

    new Setting(containerEl)
      .setName("Verbose logging")
      .setDesc("Write detailed progress to the developer console (Ctrl/Cmd+Shift+I).")
      .addToggle((toggle) =>
        toggle.setValue(settings.debug).onChange(async (value) => {
          settings.debug = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  /** Shows what the field currently resolves to and whether that file exists. */
  private pathDescription(browser: BrowserType, configured: string): DocumentFragment {
    return createFragment((frag) => {
      frag.appendText(PATH_HELP[browser]);
      frag.createEl("br");
      try {
        const resolved = resolveSourcePath(browser, configured);
        const exists = fs.existsSync(resolved);
        frag.appendText(configured.trim() ? "Using: " : "Detected default: ");
        frag.createEl("code", { text: resolved });
        frag.appendText(exists ? " (found)" : " (not found)");
      } catch (err) {
        frag.appendText(err instanceof Error ? err.message : String(err));
      }
    });
  }
}

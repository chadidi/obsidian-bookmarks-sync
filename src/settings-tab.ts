import * as fs from "fs";
import { App, type DropdownComponent, PluginSettingTab, Setting, type TextAreaComponent, debounce } from "obsidian";
import type BookmarksSyncPlugin from "./main";
import { defaultBrowserPath, resolveSourcePath } from "./paths";
import { FULL_TEMPLATE, SIMPLE_TEMPLATE } from "./settings";
import { findUnknownPlaceholders } from "./template";
import { BROWSER_LABELS, type BrowserType, type TemplatePreset } from "./types";

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
  icon = "bookmark";

  constructor(app: App, private readonly plugin: BookmarksSyncPlugin) {
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

    new Setting(containerEl)
      .setName("Browser bookmarks folder")
      .setDesc(
        createFragment((frag) => {
          frag.appendText("Sync only bookmarks inside a specific browser folder. Use ");
          frag.createEl("code", { text: "/" });
          frag.appendText(" to separate nested folders, e.g. ");
          frag.createEl("code", { text: "Bookmarks Bar/Work" });
          frag.appendText(". Leave empty to sync all bookmarks. Matching is case-insensitive.");
        }),
      )
      .addText((text) => {
        text
          .setPlaceholder("e.g. Bookmarks Bar/Work (leave empty for all)")
          .setValue(settings.rootFolder)
          .onChange((value) => {
            settings.rootFolder = value.trim();
            save();
          });
        text.inputEl.addClass("bb-wide-input");
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("x")
          .setTooltip("Clear — sync all bookmarks")
          .onClick(async () => {
            settings.rootFolder = "";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

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

    new Setting(containerEl)
      .setName("Folder structure")
      .setDesc(
        "Mirror: notes are placed in subfolders that match your browser's folder hierarchy inside the target folder. " +
        "Flat: every note goes directly into the target folder with no subfolders created.",
      )
      .addDropdown((dd) =>
        dd
          .addOption("folders", "Mirror browser folders (default)")
          .addOption("flat", "Flat — all notes in one folder")
          .setValue(settings.folderStructure)
          .onChange(async (value) => {
            settings.folderStructure = value as "folders" | "flat";
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
          .setPlaceholder("0")
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

    let dropdownComponent: DropdownComponent | null = null;
    let textAreaComponent: TextAreaComponent | null = null;
    let isProgrammaticChange = false;

    new Setting(containerEl)
      .setName("Template preset")
      .setDesc("Choose between predefined templates (Simple, Full) or customize your own.")
      .addDropdown((dd) => {
        dropdownComponent = dd;
        dd.addOption("simple", "Simple")
          .addOption("full", "Full")
          .addOption("custom", "Custom")
          .setValue(settings.templatePreset)
          .onChange(async (value) => {
            const preset = value as TemplatePreset;
            settings.templatePreset = preset;
            if (preset === "simple") {
              settings.template = SIMPLE_TEMPLATE;
            } else if (preset === "full") {
              settings.template = FULL_TEMPLATE;
            } else {
              settings.template = settings.customTemplate;
            }
            if (textAreaComponent) {
              isProgrammaticChange = true;
              textAreaComponent.setValue(settings.template);
              isProgrammaticChange = false;
            }
            refreshWarning();
            await this.plugin.saveSettings();
          });
      });

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
      textAreaComponent = area;
      area.setValue(settings.template).onChange((value) => {
        if (isProgrammaticChange) return;
        if (settings.templatePreset !== "custom") {
          settings.templatePreset = "custom";
          if (dropdownComponent) {
            dropdownComponent.setValue("custom");
          }
        }
        settings.customTemplate = value;
        settings.template = value;
        refreshWarning();
        save();
      });
      area.inputEl.rows = 16;
      area.inputEl.spellcheck = false;
    });
    refreshWarning();

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

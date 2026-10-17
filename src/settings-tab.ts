import {
  App,
  type DropdownComponent,
  PluginSettingTab,
  Setting,
  type TextAreaComponent,
  type ToggleComponent,
  debounce,
} from 'obsidian';
import type BookmarksSyncPlugin from './main';
import { checkSourceAccess, defaultBrowserPath } from './paths';
import { isVaultRootTarget } from './settings';
import { findUnknownPlaceholders } from './template';
import { CUSTOM_TEMPLATE_ID, TEMPLATE_NAMES, TEMPLATES } from './template-store';
import { BROWSER_LABELS, type BrowserType } from './types';
import { SafariPickerModal } from './ui/safari-picker-modal';

/** Display label for a template: separators become spaces and the first letter is uppercase. */
function templateLabel(name: string): string {
  const spaced = name.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const PATH_HELP: Record<BrowserType, string> = {
  chrome:
    'The Google Chrome "Bookmarks" JSON file. When you are signed in, Chrome may keep your bookmarks ' +
    'in "AccountBookmarks" instead; the plugin detects both. For a different profile, enter its ' +
    'Bookmarks file here.',
  chromium:
    'The "Bookmarks" JSON file of Chromium or another Chromium-based browser (Brave, Edge...). When ' +
    'you are signed in, it may keep your bookmarks in "AccountBookmarks" instead; the plugin detects ' +
    'both. For a different profile, enter its Bookmarks file here.',
  firefox:
    'Either places.sqlite (live data; needs the sqlite3 command-line tool) or a bookmarkbackups *.jsonlz4 file / folder ' +
    "(no extra software, but only as fresh as Firefox's last daily backup).",
  safari:
    "Safari's binary Bookmarks.plist (macOS only). Select it with the button below to grant access " +
    'without Full Disk Access, or point this field at a copy of the file.',
};

/** What the user can do to let the plugin read the select browser's bookmarks. */
const ACCESS_HINT: Record<BrowserType, string> = {
  chrome:
    'Open Google Chrome and sign in so it saves your bookmarks to disk, then reopen this tab.',
  chromium: 'Open Chromium and sign in so it saves your bookmarks to disk, then reopen this tab.',
  firefox:
    'Open Mozilla Firefox at least once (or let it create a daily bookmark backup), then reopen this tab.',
  safari:
    'Select ~/Library/Safari/Bookmarks.plist with the button above to grant access, or grant Obsidian ' +
    'Full Disk Access in System Settings → Privacy & Security, then reopen this tab.',
};

export class BookmarkSettingTab extends PluginSettingTab {
  icon = 'bookmark';

  constructor(
    app: App,
    private readonly plugin: BookmarksSyncPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    const save = debounce(() => void this.plugin.saveSettings(), 500, true);
    const reschedule = debounce(() => this.plugin.schedulePeriodicSync(), 800, true);

    /* ---------------- Source ---------------- */
    new Setting(containerEl).setName('Source').setHeading();

    new Setting(containerEl)
      .setName('Browser')
      .setDesc("Which browser's bookmarks to import.")
      .addDropdown((dd) =>
        dd
          .addOptions({
            chrome: BROWSER_LABELS.chrome,
            chromium: `${BROWSER_LABELS.chromium} (Brave, Edge...)`,
            firefox: BROWSER_LABELS.firefox,
            safari: `${BROWSER_LABELS.safari} (macOS)`,
          })
          .setValue(settings.browser)
          .onChange(async (value) => {
            settings.browser = value as BrowserType;
            await this.plugin.saveSettings();
            this.display(); // path help and extra fields depend on the browser
          }),
      );

    const browser = settings.browser;
    const pathSetting = new Setting(containerEl)
      .setName('Bookmarks file path')
      .setDesc(this.pathDescription(browser, settings.paths[browser]))
      .addText((text) => {
        text
          .setPlaceholder(defaultBrowserPath(browser) || 'No default for this platform')
          .setValue(settings.paths[browser])
          .onChange((value) => {
            settings.paths[browser] = value.trim();
            save();
          });
        text.inputEl.addClass('bb-wide-input');
      })
      .addExtraButton((btn) =>
        btn
          .setIcon('rotate-ccw')
          .setTooltip('Use the detected default')
          .onClick(async () => {
            settings.paths[browser] = '';
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    pathSetting.descEl.addClass('bb-path-desc');

    new Setting(containerEl)
      .setName('Browser bookmarks folder')
      .setDesc(
        createFragment((frag) => {
          frag.appendText('Sync only bookmarks inside a specific browser folder. Use ');
          frag.createEl('code', { text: '/' });
          frag.appendText(' to separate nested folders, e.g. ');
          frag.createEl('code', { text: 'Bookmarks Bar/Work' });
          frag.appendText('. Leave empty to sync all bookmarks. Matching is case-insensitive.');
        }),
      )
      .addText((text) => {
        text
          .setPlaceholder('e.g. Bookmarks Bar/Work (leave empty for all)')
          .setValue(settings.rootFolder)
          .onChange((value) => {
            settings.rootFolder = value.trim();
            save();
          });
        text.inputEl.addClass('bb-wide-input');
      })
      .addExtraButton((btn) =>
        btn
          .setIcon('x')
          .setTooltip('Clear: sync all bookmarks')
          .onClick(async () => {
            settings.rootFolder = '';
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (browser === 'firefox') {
      new Setting(containerEl)
        .setName('sqlite3 executable')
        .setDesc(
          createFragment((frag) => {
            frag.appendText(
              "Only used when the path above points to places.sqlite. Leave as 'sqlite3' if it is on your PATH. " +
                'Not installed? Download the ',
            );
            frag.createEl('code', { text: 'sqlite-tools-*.zip' });
            frag.appendText(' file from ');
            frag.createEl('a', {
              href: 'https://www.sqlite.org/download.html',
              text: 'sqlite.org/download.html',
            });
            frag.appendText('; it contains the sqlite3 binary.');
          }),
        )
        .addText((text) =>
          text
            .setPlaceholder('sqlite3')
            .setValue(settings.sqlite3Path)
            .onChange((value) => {
              settings.sqlite3Path = value.trim() || 'sqlite3';
              save();
            }),
        );
    }

    if (browser === 'safari') {
      this.renderSafariPicker(containerEl);
    }

    // Everything below depends on actually being able to read the browser's bookmarks,
    // so keep it hidden until that access is granted.
    const access = checkSourceAccess(browser, settings.paths[browser]);
    const hasSafariPick = browser === 'safari' && this.plugin.getSafariPick() !== null;
    if (!access.accessible && !hasSafariPick) {
      containerEl
        .createDiv({ cls: 'setting-item-description bb-warning bb-access-hint' })
        .setText(
          `Can't read the ${BROWSER_LABELS[browser]} bookmarks yet. ${ACCESS_HINT[browser]} ` +
            'The rest of the settings will appear once access is granted.',
        );
      return;
    }

    /* ---------------- Destination ---------------- */
    new Setting(containerEl).setName('Destination').setHeading();

    new Setting(containerEl)
      .setName('Target folder')
      .setDesc('Vault folder for the bookmark notes. It is created if it does not exist.')
      .addText((text) =>
        text
          .setPlaceholder('Bookmarks')
          .setValue(settings.targetFolder)
          .onChange((value) => {
            settings.targetFolder = value.trim();
            refreshTargetGuard();
            save();
          }),
      );

    const targetGuardEl = containerEl.createDiv({ cls: 'bb-target-guard' });

    const targetWarningEl = targetGuardEl.createDiv({ cls: 'setting-item-description bb-warning' });
    targetWarningEl.setText(
      'Warning: an empty target folder puts bookmark notes in your vault root. ' +
        'Existing notes there can be overwritten or deleted. Set a folder, or confirm below.',
    );

    let rootToggle: ToggleComponent | null = null;
    new Setting(targetGuardEl)
      .setName('Allow syncing into the vault root')
      .setDesc(
        'Required while the target folder is empty. Sync stays blocked until you enable this.',
      )
      .addToggle((toggle) => {
        rootToggle = toggle;
        toggle.setValue(settings.allowVaultRootTarget).onChange(async (value) => {
          settings.allowVaultRootTarget = value;
          await this.plugin.saveSettings();
        });
      });

    const refreshTargetGuard = () => {
      const isRoot = isVaultRootTarget(settings.targetFolder);
      // The acknowledgement only ever applies to a root configuration, so drop it as soon as
      // the user picks a real folder and require a fresh confirmation if they clear it again.
      if (!isRoot && settings.allowVaultRootTarget) {
        settings.allowVaultRootTarget = false;
        void this.plugin.saveSettings();
      }
      rootToggle?.setValue(settings.allowVaultRootTarget);
      targetGuardEl.toggle(isRoot);
    };
    refreshTargetGuard();

    new Setting(containerEl)
      .setName('Folder structure')
      .setDesc(
        "Mirror: notes are placed in subfolders that match your browser's folder hierarchy inside the target folder. " +
          'Flat: every note goes directly into the target folder with no subfolders created.',
      )
      .addDropdown((dd) =>
        dd
          .addOption('folders', 'Mirror browser folders (default)')
          .addOption('flat', 'Flat: all notes in one folder')
          .setValue(settings.folderStructure)
          .onChange(async (value) => {
            settings.folderStructure = value as 'folders' | 'flat';
            await this.plugin.saveSettings();
          }),
      );

    /* ---------------- Automation ---------------- */
    new Setting(containerEl).setName('Automation').setHeading();

    let intervalErrorEl: HTMLElement | null = null;

    new Setting(containerEl)
      .setName('Sync interval (minutes)')
      .setDesc(
        'How often to sync in the background. Use 0 to disable. Automatic syncs only start after you have ' +
          'run one manual sync successfully, so nothing is imported by surprise. ' +
          'We recommend 10 minutes or more.',
      )
      .addText((text) => {
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.step = '1';

        // Stack the error message directly under the input instead of after the whole row.
        const control = text.inputEl.parentElement;
        if (control) {
          const wrap = control.createDiv({ cls: 'bb-interval-input' });
          wrap.appendChild(text.inputEl);
          intervalErrorEl = wrap.createDiv({ cls: 'setting-item-description bb-error' });
        }

        text
          .setPlaceholder('0')
          .setValue(String(settings.intervalMinutes))
          .onChange((value) => {
            const minutes = Number(value);
            // Accept only unsigned integers; show a red error and keep the previous value otherwise.
            const invalid = value.trim() !== '' && (!Number.isInteger(minutes) || minutes < 0);
            if (invalid) {
              refreshIntervalError(true);
              return;
            }
            settings.intervalMinutes = Math.min(minutes, 10080);
            save();
            reschedule();
            refreshIntervalError(false);
          });
      });

    const refreshIntervalError = (invalid: boolean) => {
      if (!intervalErrorEl) return;
      intervalErrorEl.setText(invalid ? 'Enter a whole number of minutes (0 or more).' : '');
      intervalErrorEl.toggle(invalid);
    };

    new Setting(containerEl)
      .setName('Sync on startup')
      .setDesc('Run a sync once Obsidian has finished loading.')
      .addToggle((toggle) =>
        toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
          settings.syncOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Sync now')
      .setDesc('Run a sync immediately.')
      .addButton((btn) =>
        btn
          .setButtonText('Sync bookmarks')
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            try {
              await this.plugin.syncNow('manual');
            } finally {
              btn.setDisabled(false);
            }
          }),
      );

    /* ---------------- Template ---------------- */
    new Setting(containerEl).setName('Template').setHeading();

    // A template name can disappear when a bundled template is renamed or removed; fall back so
    // the dropdown never shows a value it does not list.
    if (
      settings.templateName !== CUSTOM_TEMPLATE_ID &&
      !TEMPLATE_NAMES.includes(settings.templateName)
    ) {
      settings.templateName = TEMPLATE_NAMES[0] ?? CUSTOM_TEMPLATE_ID;
      void this.plugin.saveSettings();
    }

    let templateArea: TextAreaComponent | null = null;
    let templateDropdown: DropdownComponent | null = null;

    /** Body of the selected template: the bundled template, or the custom template. */
    function activeTemplateBody(): string {
      if (settings.templateName === CUSTOM_TEMPLATE_ID) return settings.customTemplate;
      return TEMPLATES[settings.templateName] ?? '';
    }

    /** Shows the body of the selected template in the editor. */
    function refreshTemplateArea(): void {
      if (templateArea) templateArea.setValue(activeTemplateBody());
    }

    /**
     * Forks the current selection into the custom template, leaving the bundled template
     * untouched. Used as soon as the user edits the body of a built-in template.
     */
    function switchToCustomTemplate(): void {
      settings.templateName = CUSTOM_TEMPLATE_ID;
      templateDropdown?.setValue(CUSTOM_TEMPLATE_ID);
    }

    new Setting(containerEl)
      .setName('Template')
      .setDesc('Choose a template for your bookmarks.')
      .addDropdown((dd) => {
        templateDropdown = dd;
        for (const name of TEMPLATE_NAMES) {
          dd.addOption(name, templateLabel(name));
        }
        dd.addOption(CUSTOM_TEMPLATE_ID, 'Custom')
          .setValue(settings.templateName)
          .onChange(async (value) => {
            settings.templateName = value;
            refreshTemplateArea();
            refreshWarning();
            await this.plugin.saveSettings();
          });
      });

    const templateSetting = new Setting(containerEl).setName('Template content').setDesc(
      createFragment((frag) => {
        frag.appendText('Editing a built-in template switches to Custom.');
        frag.createEl('br');
        frag.appendText('Placeholders: ');
        [
          '{{title}}',
          '{{url}}',
          '{{date}}',
          '{{folder_path}}',
          '{{folder}}',
          '{{folder_links}}',
          '{{folder_links_yaml}}',
          '{{folder_tags}}',
          '{{folder_hashtags}}',
          '{{domain}}',
          '{{browser}}',
          '{{synced}}',
        ].forEach((placeholder, index) => {
          if (index) frag.appendText(', ');
          frag.createEl('code', { text: placeholder, cls: 'bb-placeholder' });
        });
        frag.createEl('br');
        frag.appendText('Dates accept a moment.js format, e.g. ');
        frag.createEl('code', { text: '{{date:YYYY-MM-DD}}', cls: 'bb-placeholder' });
        frag.appendText(', and ');
        frag.createEl('code', { text: '{{title|yaml}}', cls: 'bb-placeholder' });
        frag.appendText(' quotes a value for front matter.');
      }),
    );
    templateSetting.settingEl.addClass('bb-template-setting');

    const warningEl = containerEl.createDiv({
      cls: 'setting-item-description bb-warning',
    });

    function refreshWarning(): void {
      const unknown = findUnknownPlaceholders(activeTemplateBody());
      warningEl.setText(
        unknown.length ? `Unknown placeholders (will be left as-is): ${unknown.join(', ')}` : '',
      );
    }

    templateSetting.addTextArea((area) => {
      templateArea = area;
      area.setValue(activeTemplateBody()).onChange((value) => {
        // Editing a file template forks it into the custom template instead of writing the file.
        if (settings.templateName !== CUSTOM_TEMPLATE_ID) switchToCustomTemplate();
        settings.customTemplate = value;
        refreshWarning();
        save();
      });
      area.inputEl.rows = 16;
      area.inputEl.spellcheck = false;
    });
    refreshWarning();

    /* ---------------- Diagnostics ---------------- */
    new Setting(containerEl).setName('Diagnostics').setHeading();

    new Setting(containerEl)
      .setName('Verbose logging')
      .setDesc('Write detailed progress to the developer console (Ctrl/Cmd+Shift+I).')
      .addToggle((toggle) =>
        toggle.setValue(settings.debug).onChange(async (value) => {
          settings.debug = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  /**
   * Lets the user hand the plugin a Safari Bookmarks.plist through the native file picker.
   * Picking the file grants macOS read access to just that file for this session, so the field
   * above can stay empty and Full Disk Access is not required.
   */
  private renderSafariPicker(containerEl: HTMLElement): void {
    const pick = this.plugin.getSafariPick();
    const setting = new Setting(containerEl)
      .setName('Safari bookmarks file')
      .setDesc(
        pick
          ? `Using the file you selected this session: ${pick.fileName}. macOS keeps this access ` +
              'until Obsidian is closed.'
          : 'macOS protects ~/Library/Safari/, so the path above may not be readable on its own. ' +
              'Select Bookmarks.plist below to grant read access for this session. Full Disk ' +
              'Access is not required.',
      )
      .addButton((btn) =>
        btn
          .setButtonText(pick ? 'Choose a different file' : 'Choose Bookmarks.plist')
          .setCta()
          .onClick(() => {
            new SafariPickerModal(this.app, this.plugin.log, (picked) => {
              this.plugin.setSafariPick(picked);
              this.display();
            }).open();
          }),
      );

    if (pick) {
      setting.addExtraButton((btn) =>
        btn
          .setIcon('x')
          .setTooltip('Forget the selected file')
          .onClick(() => {
            this.plugin.setSafariPick(null);
            this.display();
          }),
      );
    }
  }

  /** Shows what the field currently resolves to and whether it can be read. */
  private pathDescription(browser: BrowserType, configured: string): DocumentFragment {
    return createFragment((frag) => {
      frag.appendText(PATH_HELP[browser]);
      frag.createEl('br');
      const access = checkSourceAccess(browser, configured);
      if (!access.resolved) {
        frag.appendText(access.error ?? 'No bookmarks location is known for this platform.');
        return;
      }
      frag.appendText(configured.trim() ? 'Using: ' : 'Detected default: ');
      frag.createEl('code', { text: access.resolved });
      if (!access.exists) frag.appendText(' (not found)');
      else if (!access.accessible) frag.appendText(' (no permission)');
      else frag.appendText(' (found)');
    });
  }
}

import {
  App,
  type DropdownComponent,
  PluginSettingTab,
  type SettingDefinitionItem,
  type SettingGroupItem,
  type TextAreaComponent,
  debounce,
} from 'obsidian';
import { BROWSER_NAMES, detectBrowsersSync } from 'browsers-detect';
import type BookmarksSyncPlugin from './main';
import { checkSourceAccess } from './paths';
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

function accessHint(browser: BrowserType): string {
  if (browser === 'safari')
    return 'Select ~/Library/Safari/Bookmarks.plist with the button above, or grant Obsidian Full Disk Access and reopen this tab.';
  return `Open ${BROWSER_LABELS[browser]} at least once so it saves bookmarks locally, then reopen this tab.`;
}

export class BookmarkSettingTab extends PluginSettingTab {
  icon = 'bookmark';

  private readonly saveSoon = debounce(() => void this.plugin.saveSettings(), 500, true);
  private readonly rescheduleSoon = debounce(() => this.plugin.schedulePeriodicSync(), 800, true);

  constructor(
    app: App,
    private readonly plugin: BookmarksSyncPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const browser = settings.browser;

    // A template name can disappear when a bundled template is renamed or removed; fall back so
    // the dropdown never shows a value it does not list.
    if (
      settings.templateName !== CUSTOM_TEMPLATE_ID &&
      !TEMPLATE_NAMES.includes(settings.templateName)
    ) {
      settings.templateName = TEMPLATE_NAMES[0] ?? CUSTOM_TEMPLATE_ID;
      void this.plugin.saveSettings();
    }

    const sourceItems = this.sourceItems(browser);

    // Everything below depends on actually being able to read the browser's bookmarks,
    // so keep it hidden until that access is granted.
    const access = checkSourceAccess(browser, settings.profiles[browser]);
    const hasSafariPick = browser === 'safari' && this.plugin.getSafariPick() !== null;
    if (!access.accessible && !hasSafariPick) {
      return [
        { type: 'group', heading: 'Source', items: sourceItems },
        this.accessWarningItem(browser),
      ];
    }

    return [
      { type: 'group', heading: 'Source', items: sourceItems },
      { type: 'group', heading: 'Destination', items: this.destinationItems() },
      this.targetGuardGroup(),
      { type: 'group', heading: 'Automation', items: this.automationItems() },
      { type: 'group', heading: 'Template', items: this.templateItems() },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Source                                                              */
  /* ------------------------------------------------------------------ */

  private sourceItems(browser: BrowserType): SettingGroupItem[] {
    const settings = this.plugin.settings;
    const detected = detectBrowsersSync();
    const browserOptions = Object.fromEntries(
      detected.map((candidate) => [candidate.id, candidate.name]),
    ) as Record<string, string>;
    // Keep an old selection visible when its application is temporarily unavailable.
    if (!browserOptions[settings.browser])
      browserOptions[settings.browser] = BROWSER_NAMES[settings.browser];
    const items: SettingGroupItem[] = [];

    items.push({
      name: 'Browser',
      desc: "Which browser's bookmarks to import.",
      render: (setting) => {
        setting.addDropdown((dd) =>
          dd
            .addOptions(browserOptions)
            .setValue(settings.browser)
            .onChange(async (value) => {
              settings.browser = value as BrowserType;
              const firstProfile = detectBrowsersSync().find(
                (candidate) => candidate.id === settings.browser,
              )?.profiles[0];
              settings.profiles[settings.browser] = firstProfile?.id ?? '';
              await this.plugin.saveSettings();
              // The profiles and access gate depend on the selected browser.
              this.update();
            }),
        );
      },
    });

    const selectedBrowser = detected.find((candidate) => candidate.id === browser);
    const selectedProfile =
      selectedBrowser?.profiles.find((profile) => profile.id === settings.profiles[browser]) ??
      selectedBrowser?.profiles[0];
    const profileOptions = Object.fromEntries(
      (selectedBrowser?.profiles ?? []).map((profile) => [profile.id, profile.name]),
    ) as Record<string, string>;
    items.push({
      name: 'Profile',
      desc: selectedProfile
        ? `Bookmarks from ${selectedProfile.name}. The profile's bookmark file is detected automatically.`
        : 'No local profiles were detected for this browser yet.',
      render: (setting) => {
        if (!selectedProfile) return;
        setting.addDropdown((dd) =>
          dd
            .addOptions(profileOptions)
            .setValue(selectedProfile.id)
            .onChange(async (value) => {
              settings.profiles[browser] = value;
              await this.plugin.saveSettings();
              this.update();
            }),
        );
      },
    });

    items.push({
      name: 'Bookmarks folder',
      desc: createFragment((frag) => {
        frag.appendText('Sync only bookmarks inside a specific browser folder. Use ');
        frag.createEl('code', { text: '/' });
        frag.appendText(' to separate nested folders, e.g. ');
        frag.createEl('code', { text: 'Favorites/work' });
        frag.appendText('. Leave empty to sync all bookmarks. Matching is case-insensitive.');
      }),
      render: (setting) => {
        setting
          .addText((text) => {
            text
              .setPlaceholder('E.g. Favorites/work (leave empty for all)')
              .setValue(settings.rootFolder)
              .onChange((value) => {
                settings.rootFolder = value.trim();
                this.saveSoon();
              });
          })
          .addExtraButton((btn) =>
            btn
              .setIcon('x')
              .setTooltip('Clear: sync all bookmarks')
              .onClick(async () => {
                settings.rootFolder = '';
                await this.plugin.saveSettings();
                this.update();
              }),
          );
      },
    });

    if (browser === 'safari') {
      items.push(this.safariPickerItem());
    }

    return items;
  }

  /** Full-width warning shown as its own block, outside the Source block, until access is granted. */
  private accessWarningItem(browser: BrowserType): SettingDefinitionItem {
    return {
      type: 'group',
      cls: 'bb-callout',
      items: [
        {
          name: '',
          desc:
            `Can't read the ${BROWSER_LABELS[browser]} bookmarks yet. ${accessHint(browser)} ` +
            'The rest of the settings will appear once access is granted.',
          searchable: false,
          render: (setting) => {
            setting.descEl.addClass('bb-warning');
          },
        },
      ],
    };
  }

  /**
   * Lets the user hand the plugin a Safari Bookmarks.plist through the native file picker.
   * Picking the file grants macOS read access to just that file for this session, so the field
   * above can stay empty and Full Disk Access is not required.
   */
  private safariPickerItem(): SettingGroupItem {
    const pick = this.plugin.getSafariPick();
    return {
      name: 'Safari bookmarks file',
      desc: pick
        ? `Using the file you selected this session: ${pick.fileName}. macOS keeps this access ` +
          'until Obsidian is closed.'
        : 'macOS protects ~/Library/Safari/, so the path above may not be readable on its own. ' +
          'Select Bookmarks.plist below to grant read access for this session. Full Disk ' +
          'Access is not required.',
      render: (setting) => {
        setting.addButton((btn) =>
          btn
            .setButtonText(pick ? 'Choose a different file' : 'Choose Bookmarks.plist')
            .setCta()
            .onClick(() => {
              new SafariPickerModal(this.app, this.plugin.log, (picked) => {
                this.plugin.setSafariPick(picked);
                this.update();
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
                this.update();
              }),
          );
        }
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Destination                                                         */
  /* ------------------------------------------------------------------ */

  private destinationItems(): SettingGroupItem[] {
    const settings = this.plugin.settings;
    return [
      {
        name: 'Target folder',
        desc: 'Vault folder for the bookmark notes. It is created if it does not exist.',
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder('Bookmarks')
              .setValue(settings.targetFolder)
              .onChange((value) => {
                const wasRoot = isVaultRootTarget(settings.targetFolder);
                settings.targetFolder = value.trim();
                const isRoot = isVaultRootTarget(settings.targetFolder);
                // The acknowledgement only ever applies to a root configuration, so drop it as
                // soon as the user picks a real folder and require a fresh confirmation if they
                // clear it again.
                if (!isRoot && settings.allowVaultRootTarget) {
                  settings.allowVaultRootTarget = false;
                  void this.plugin.saveSettings();
                }
                this.saveSoon();
                // Adding or removing the confirmation block changes the set of definitions.
                if (wasRoot !== isRoot) this.update();
              }),
          );
        },
      },
      {
        name: 'Folder structure',
        desc:
          "Mirror: notes are placed in subfolders that match your browser's folder hierarchy inside the target folder. " +
          'Flat: every note goes directly into the target folder with no subfolders created.',
        render: (setting) => {
          setting.addDropdown((dd) =>
            dd
              .addOption('folders', 'Mirror browser folders (default)')
              .addOption('flat', 'Flat: all notes in one folder')
              .setValue(settings.folderStructure)
              .onChange(async (value) => {
                settings.folderStructure = value as 'folders' | 'flat';
                await this.plugin.saveSettings();
              }),
          );
        },
      },
    ];
  }

  /** The root-target warning plus its confirmation toggle, shown only for a root target. */
  private targetGuardGroup(): SettingDefinitionItem {
    const settings = this.plugin.settings;
    return {
      type: 'group',
      cls: 'bb-callout',
      visible: isVaultRootTarget(settings.targetFolder),
      items: [
        {
          name: '',
          desc:
            'Warning: an empty target folder puts bookmark notes in your vault root. ' +
            'Existing notes there can be overwritten or deleted. Set a folder, or confirm below.',
          searchable: false,
          render: (setting) => {
            setting.descEl.addClass('bb-warning');
          },
        },
        {
          name: 'Allow syncing into the vault root',
          desc: 'Required while the target folder is empty. Sync stays blocked until you enable this.',
          render: (setting) => {
            setting.addToggle((toggle) =>
              toggle.setValue(settings.allowVaultRootTarget).onChange(async (value) => {
                settings.allowVaultRootTarget = value;
                await this.plugin.saveSettings();
              }),
            );
          },
        },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /* Automation                                                          */
  /* ------------------------------------------------------------------ */

  private automationItems(): SettingGroupItem[] {
    const settings = this.plugin.settings;
    return [
      {
        name: 'Sync interval (minutes)',
        desc:
          'How often to sync in the background. Use 0 to disable. Automatic syncs only start after you have ' +
          'run one manual sync successfully, so nothing is imported by surprise. ' +
          'We recommend 10 minutes or more.',
        render: (setting) => {
          let errorEl: HTMLElement | null = null;
          const refreshError = (invalid: boolean) => {
            if (!errorEl) return;
            errorEl.setText(invalid ? 'Enter a whole number of minutes (0 or more).' : '');
            errorEl.toggle(invalid);
          };
          setting.addText((text) => {
            text.inputEl.type = 'number';
            text.inputEl.min = '0';
            text.inputEl.step = '1';

            // Stack the error message directly under the input instead of after the whole row.
            const control = text.inputEl.parentElement;
            if (control) {
              const wrap = control.createDiv({ cls: 'bb-interval-input' });
              wrap.appendChild(text.inputEl);
              errorEl = wrap.createDiv({ cls: 'setting-item-description bb-error' });
            }

            text
              .setPlaceholder('0')
              .setValue(String(settings.intervalMinutes))
              .onChange((value) => {
                const minutes = Number(value);
                // Accept only unsigned integers; show a red error and keep the previous value otherwise.
                const invalid = value.trim() !== '' && (!Number.isInteger(minutes) || minutes < 0);
                if (invalid) {
                  refreshError(true);
                  return;
                }
                settings.intervalMinutes = Math.min(minutes, 10080);
                this.saveSoon();
                this.rescheduleSoon();
                refreshError(false);
              });
          });
        },
      },
      {
        name: 'Sync on startup',
        desc: 'Run a sync once Obsidian has finished loading.',
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
              settings.syncOnStartup = value;
              await this.plugin.saveSettings();
            }),
          );
        },
      },
      {
        name: 'Sync now',
        desc: 'Run a sync immediately.',
        render: (setting) => {
          setting.addButton((btn) =>
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
        },
      },
    ];
  }

  /* ------------------------------------------------------------------ */
  /* Template                                                            */
  /* ------------------------------------------------------------------ */

  private templateItems(): SettingGroupItem[] {
    const settings = this.plugin.settings;
    let templateArea: TextAreaComponent | null = null;
    let templateDropdown: DropdownComponent | null = null;

    /** Body of the selected template: the bundled template, or the custom template. */
    const activeTemplateBody = (): string =>
      settings.templateName === CUSTOM_TEMPLATE_ID
        ? settings.customTemplate
        : (TEMPLATES[settings.templateName] ?? '');

    /** Shows the body of the selected template in the editor. */
    const refreshTemplateArea = (): void => {
      if (templateArea) templateArea.setValue(activeTemplateBody());
    };

    /**
     * Forks the current selection into the custom template, leaving the bundled template
     * untouched. Used as soon as the user edits the body of a built-in template.
     */
    const switchToCustomTemplate = (): void => {
      settings.templateName = CUSTOM_TEMPLATE_ID;
      templateDropdown?.setValue(CUSTOM_TEMPLATE_ID);
    };

    const refreshWarning = (): void => {
      const unknown = findUnknownPlaceholders(activeTemplateBody());
      if (!warningEl) return;
      warningEl.setText(
        unknown.length ? `Unknown placeholders (will be left as-is): ${unknown.join(', ')}` : '',
      );
    };

    let warningEl: HTMLElement | null = null;

    return [
      {
        name: 'Template',
        desc: 'Choose a template for your bookmarks.',
        render: (setting) => {
          setting.addDropdown((dd) => {
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
        },
      },
      {
        name: 'Template content',
        desc: createFragment((frag) => {
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
        render: (setting) => {
          setting.addTextArea((area) => {
            templateArea = area;
            area.setValue(activeTemplateBody()).onChange((value) => {
              // Editing a file template forks it into the custom template instead of writing the file.
              if (settings.templateName !== CUSTOM_TEMPLATE_ID) switchToCustomTemplate();
              settings.customTemplate = value;
              refreshWarning();
              this.saveSoon();
            });
            area.inputEl.rows = 16;
            area.inputEl.spellcheck = false;
          });
          setting.settingEl.addClass('bb-template-setting');
        },
      },
    ];
  }
}

import { App, Modal, Setting } from 'obsidian';
import { errorMessage } from '../errors';
import type { Logger } from '../logger';
import { parseSafariBookmarks } from '../sources/safari';
import type { SafariPick } from '../types';

/** The folder macOS protects; pasting it into the picker's "Go to Folder" dialog lands the user here. */
const SAFARI_FOLDER = '~/Library/Safari/';

/**
 * Guides the user through picking Safari's Bookmarks.plist with the native macOS file dialog.
 * Selecting the file grants read access to just that file for this session, so no Full Disk
 * Access is needed. The chosen bytes are validated before being handed back.
 */
export class SafariPickerModal extends Modal {
  private errorEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly log: Logger,
    private readonly onPicked: (pick: SafariPick) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('bb-safari-picker');
    contentEl.createEl('h2', { text: 'Grant access to safari bookmarks' });

    contentEl.createEl('p', {
      text:
        'macOS protects the Safari bookmarks folder. Choosing the file yourself grants this plugin ' +
        'read access to just that file for this session. Full Disk Access is not required.',
    });

    const steps = contentEl.createEl('ol', { cls: 'bb-picker-steps' });
    addStep(steps, 'Click "Choose bookmarks.plist" below to open the macOS file picker.');
    addStep(steps, 'In the Finder window, press Cmd+Shift+G to open "Go to folder".');
    addStep(steps, 'Paste the path below and press Enter.');
    addStep(steps, 'Select Bookmarks.plist and click Open.');

    contentEl.createDiv({ cls: 'bb-picker-path' }).createEl('code', { text: SAFARI_FOLDER });

    // A real HTML file input is what opens the native macOS picker from Obsidian's Electron window.
    const input = contentEl.createEl('input', { type: 'file' });
    input.accept = '.plist';
    input.addClass('bb-hidden-input');
    input.addEventListener('change', () => void this.handleSelection(input));

    this.errorEl = contentEl.createDiv({ cls: 'bb-picker-error' });
    this.errorEl.hide();

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Choose bookmarks.plist')
          .setCta()
          .onClick(() => input.click()),
      )
      .addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async handleSelection(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // reset so the same file can be picked again later
    if (!file) return; // the picker was cancelled

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      // Parse now: a wrong file or a denied read is reported while the user is still in the modal.
      parseSafariBookmarks(buffer, this.log, file.name);
      const path = (file as File & { path?: string }).path;
      this.onPicked({ buffer, path: typeof path === 'string' ? path : '', fileName: file.name });
      this.close();
    } catch (err) {
      this.showError(
        `That file could not be read as a Safari Bookmarks.plist (${errorMessage(err)}). ` +
          `Make sure you selected Bookmarks.plist inside ${SAFARI_FOLDER} and try again.`,
      );
    }
  }

  private showError(message: string): void {
    if (!this.errorEl) return;
    this.errorEl.setText(message);
    this.errorEl.show();
  }
}

function addStep(list: HTMLOListElement, text: string): void {
  list.createEl('li', { text });
}

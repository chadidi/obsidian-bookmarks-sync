import type { BookmarkSettings, BrowserType, FolderStructure } from './types';
import { CUSTOM_TEMPLATE_ID, DEFAULT_TEMPLATE, TEMPLATES } from './template-store';

export const DEFAULT_SETTINGS: BookmarkSettings = {
  browser: 'chrome',
  paths: { chrome: '', chromium: '', firefox: '', safari: '' },
  targetFolder: 'Bookmarks',
  allowVaultRootTarget: false,
  rootFolder: '',
  folderStructure: 'folders',
  intervalMinutes: 0,
  syncOnStartup: true,
  templateName: 'simple',
  customTemplate: DEFAULT_TEMPLATE,
  debug: false,
  initialSyncDone: false,
};

/**
 * Template fields written by plugin versions that kept every template inline. Still read so
 * existing vaults keep their chosen template after the move to markdown template files.
 */
interface LegacyTemplateFields {
  templatePreset?: string;
  template?: string;
}

/** Shape of a stored settings object: current fields plus the deprecated template fields. */
export type StoredSettings = Partial<BookmarkSettings> & LegacyTemplateFields;

/**
 * True when the target folder resolves to the vault root (empty or "/"). Syncing there can
 * overwrite or delete unrelated notes, so it requires an explicit confirmation.
 */
export function isVaultRootTarget(targetFolder: string): boolean {
  const trimmed = targetFolder.trim();
  return trimmed === '' || trimmed === '/';
}

const BROWSERS: BrowserType[] = ['chrome', 'chromium', 'firefox', 'safari'];

/**
 * Resolves which template a stored settings object should use. New data stores templateName
 * directly; older data only stored a preset plus the template body, so it is mapped over.
 */
function normalizeTemplateName(raw: StoredSettings | undefined | null): string {
  const stored = typeof raw?.templateName === 'string' ? raw.templateName.trim() : '';
  if (stored) return stored;

  if (raw?.templatePreset === 'full') return 'full';
  if (raw?.templatePreset === 'simple') return 'simple';
  if (raw?.templatePreset === 'custom') return CUSTOM_TEMPLATE_ID;

  const body = typeof raw?.template === 'string' ? raw.template.trim() : '';
  if (!body || body === TEMPLATES.simple) return 'simple';
  if (body === TEMPLATES.full) return 'full';
  return CUSTOM_TEMPLATE_ID;
}

/** Merges stored data over the defaults and repairs any invalid values. */
export function normalizeSettings(raw: StoredSettings | undefined | null): BookmarkSettings {
  const merged: BookmarkSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    paths: { ...DEFAULT_SETTINGS.paths, ...(raw?.paths ?? {}) },
  };
  if (!BROWSERS.includes(merged.browser)) merged.browser = DEFAULT_SETTINGS.browser;
  if (!Number.isFinite(merged.intervalMinutes) || merged.intervalMinutes < 0) {
    merged.intervalMinutes = DEFAULT_SETTINGS.intervalMinutes;
  }
  merged.intervalMinutes = Math.min(Math.floor(merged.intervalMinutes), 10080); // max one week

  merged.templateName = normalizeTemplateName(raw);

  const hasExplicitCustom =
    typeof raw?.customTemplate === 'string' && Boolean(raw.customTemplate.trim());
  if (!hasExplicitCustom) {
    merged.customTemplate =
      merged.templateName === CUSTOM_TEMPLATE_ID &&
      typeof raw?.template === 'string' &&
      raw.template.trim()
        ? raw.template
        : DEFAULT_TEMPLATE;
  }

  if (typeof merged.targetFolder !== 'string') merged.targetFolder = DEFAULT_SETTINGS.targetFolder;
  merged.allowVaultRootTarget = raw?.allowVaultRootTarget === true;
  // Syncing into the vault root always starts unconfirmed, so the user must acknowledge the risk
  // again whenever the target folder is the root.
  if (isVaultRootTarget(merged.targetFolder)) merged.allowVaultRootTarget = false;
  if (typeof merged.rootFolder !== 'string') merged.rootFolder = '';
  const FOLDER_STRUCTURES: FolderStructure[] = ['folders', 'flat'];
  if (!FOLDER_STRUCTURES.includes(merged.folderStructure)) merged.folderStructure = 'folders';
  return merged;
}

import { createHash } from 'crypto';

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const REPLACE_WITH_DASH = /[\\/:|]+/g;
// eslint-disable-next-line no-control-regex -- control characters are intentionally stripped from filenames
const STRIP = /[*?"<>#^[\]\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Turns an arbitrary page title into a file name that is valid on Windows, macOS and Linux
 * and that Obsidian can link to. Does NOT include the extension.
 *  - `\ / : |` become "-" ; `* ? " < >` and control characters are removed
 *  - `# ^ [ ]` are removed because they break [[wikilinks]]
 *  - leading dots (hidden files) and trailing dots/spaces (rejected by Windows) are trimmed
 *  - reserved Windows device names (CON, NUL, COM1 ...) are prefixed with "_"
 */
export function sanitizeFileName(raw: string, maxLength = 100): string {
  let name = raw
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(REPLACE_WITH_DASH, '-')
    .replace(STRIP, '')
    .replace(/\s+/g, ' ')
    .trim();

  name = name.replace(/^\.+/, '');
  // Truncate by code point so we never cut a surrogate pair in half.
  name = Array.from(name).slice(0, maxLength).join('');
  name = name.replace(/[. ]+$/, '').trim();

  if (!name) name = 'Untitled';
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  return name;
}

/**
 * Sanitizes a folder name segment for use in a vault path.
 * Uses lighter rules than sanitizeFileName: characters like #, ^, [ ] are
 * perfectly legal in folder names and must not be stripped (they only matter
 * for [[wikilinks]] in file names).
 *  - `\ /` become "-" (path separators would break the hierarchy)
 *  - `: * ? " < > |` and control characters are removed (OS / Windows restrictions)
 *  - Leading dots and trailing dots/spaces are trimmed
 *  - Reserved Windows device names are prefixed with "_"
 */
export function sanitizeFolderName(raw: string, maxLength = 100): string {
  const FOLDER_REPLACE_WITH_DASH = /[\\/]+/g;
  // eslint-disable-next-line no-control-regex -- control characters are intentionally stripped from folder names
  const FOLDER_STRIP = /[:*?"<>|\u0000-\u001f\u007f]/g;

  let name = raw
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .replace(FOLDER_REPLACE_WITH_DASH, '-')
    .replace(FOLDER_STRIP, '')
    .replace(/\s+/g, ' ')
    .trim();

  name = name.replace(/^\.+/, '');
  name = Array.from(name).slice(0, maxLength).join('');
  name = name.replace(/[. ]+$/, '').trim();

  if (!name) name = 'Untitled';
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  return name;
}

export function shortHash(value: string, length = 6): string {
  return createHash('sha1').update(value).digest('hex').slice(0, length);
}

/** Lets the renderer paint and handle input between batches of work. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function joinVaultPath(folder: string, fileName: string): string {
  return folder === '' || folder === '/' ? fileName : `${folder}/${fileName}`;
}

export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Returns the user's preferred date format by reading Obsidian's Daily Notes
 * core plugin setting. Falls back to "YYYY-MM-DD" if the plugin is disabled
 * or its format is empty.
 *
 * Uses the internal plugin API (undocumented but stable in practice).
 */
export function getObsidianDateFormat(app: unknown): string {
  try {
    const plugins = (
      app as {
        internalPlugins?: {
          getPluginById?: (id: string) => {
            enabled?: boolean;
            instance?: { options?: { format?: string } };
          } | null;
        };
      }
    ).internalPlugins;
    const plugin = plugins?.getPluginById?.('daily-notes');
    if (plugin?.enabled) {
      const format = plugin.instance?.options?.format;
      if (format && format.trim()) return format.trim();
    }
  } catch {
    // Silently fall through to the default.
  }
  return 'YYYY-MM-DD';
}

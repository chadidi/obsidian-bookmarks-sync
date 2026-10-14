import { createHash } from "crypto";

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const REPLACE_WITH_DASH = /[\\/:|]+/g;
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
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(REPLACE_WITH_DASH, "-")
    .replace(STRIP, "")
    .replace(/\s+/g, " ")
    .trim();

  name = name.replace(/^\.+/, "");
  // Truncate by code point so we never cut a surrogate pair in half.
  name = Array.from(name).slice(0, maxLength).join("");
  name = name.replace(/[. ]+$/, "").trim();

  if (!name) name = "Untitled";
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  return name;
}

export function shortHash(value: string, length = 6): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

/** Lets the renderer paint and handle input between batches of work. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function joinVaultPath(folder: string, fileName: string): string {
  return folder === "" || folder === "/" ? fileName : `${folder}/${fileName}`;
}

export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

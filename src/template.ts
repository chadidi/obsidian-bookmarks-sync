import { BROWSER_LABELS, type BrowserType } from "./types";

export interface TemplateContext {
  title: string;
  url: string;
  /** When the bookmark was added (falls back to the sync time if the browser doesn't record it). */
  date: Date;
  /** When this sync ran. */
  synced: Date;
  folderPath: string[];
  browser: BrowserType;
}

export type DateFormatter = (date: Date, format: string) => string;

export const PLACEHOLDERS = [
  "title",
  "url",
  "date",
  "folder_path",
  "folder",
  "domain",
  "browser",
  "synced",
] as const;

/**
 * {{name}}  {{name:argument}}  {{name|filter}}  {{name:argument|filter}}
 * e.g. {{title|yaml}}  {{date:YYYY-MM-DD HH:mm}}
 */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_]+)(?::([^|}]*))?(?:\|\s*([A-Za-z]+))?\s*\}\}/g;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function applyFilter(value: string, filter: string | undefined): string {
  switch ((filter ?? "").toLowerCase()) {
    case "yaml":
      // A JSON string is a valid YAML double-quoted scalar: safe for titles with ":" or quotes.
      return JSON.stringify(value);
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    default:
      return value;
  }
}

export function renderTemplate(
  template: string,
  ctx: TemplateContext,
  formatDate: DateFormatter,
  defaultDateFormat: string,
): string {
  return template.replace(PLACEHOLDER_RE, (match, rawName: string, arg: string | undefined, filter: string | undefined) => {
    let value: string;
    switch (rawName.toLowerCase()) {
      case "title":
        value = ctx.title;
        break;
      case "url":
        value = ctx.url;
        break;
      case "date":
        value = formatDate(ctx.date, arg?.trim() || defaultDateFormat);
        break;
      case "synced":
        value = formatDate(ctx.synced, arg?.trim() || defaultDateFormat);
        break;
      case "folder_path":
        value = ctx.folderPath.join("/");
        break;
      case "folder":
        value = ctx.folderPath[ctx.folderPath.length - 1] ?? "";
        break;
      case "domain":
        value = domainOf(ctx.url);
        break;
      case "browser":
        value = BROWSER_LABELS[ctx.browser];
        break;
      default:
        return match; // unknown placeholder: leave untouched so the mistake is visible
    }
    return applyFilter(value, filter);
  });
}

export function findUnknownPlaceholders(template: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  const unknown = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const placeholder = m[1];
    if (placeholder && !known.has(placeholder.toLowerCase())) unknown.add(`{{${placeholder}}}`);
  }
  return [...unknown];
}

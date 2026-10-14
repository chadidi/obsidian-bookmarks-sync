import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BookmarkSourceError } from "./errors";
import { BROWSER_LABELS, type BrowserType } from "./types";

/** Expands `~`, `%VAR%`, `$VAR` and `${VAR}` in user-supplied paths. */
export function expandPath(input: string): string {
  let p = input.trim();
  if (!p) return "";
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  p = p.replace(/%([^%]+)%/g, (m, name: string) => process.env[name] ?? m);
  p = p.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name: string) => process.env[name] ?? m);
  return path.normalize(p);
}

function firefoxProfileRoots(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return [path.join(home, "Library", "Application Support", "Firefox", "Profiles")];
    case "win32":
      return [path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Mozilla", "Firefox", "Profiles")];
    default:
      return [
        path.join(home, ".mozilla", "firefox"),
        path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
        path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
      ];
  }
}

/** Finds places.sqlite of the most plausible Firefox profile (prefers *.default-release). */
export function detectFirefoxPlacesPath(): string | null {
  const found: { file: string; score: number; mtime: number }[] = [];
  for (const root of firefoxProfileRoots()) {
    let dirs: fs.Dirent[];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const file = path.join(root, dir.name, "places.sqlite");
      try {
        const stat = fs.statSync(file);
        found.push({ file, score: dir.name.endsWith(".default-release") ? 1 : 0, mtime: stat.mtimeMs });
      } catch {
        /* profile without bookmarks database */
      }
    }
  }
  found.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return found[0]?.file ?? null;
}

/** Platform default for a browser, or "" when there is none. */
export function defaultBrowserPath(browser: BrowserType): string {
  const home = os.homedir();
  switch (browser) {
    case "chrome":
      switch (process.platform) {
        case "darwin":
          return path.join(home, "Library", "Application Support", "Google", "Chrome", "Default", "Bookmarks");
        case "win32":
          return path.join(
            process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
            "Google", "Chrome", "User Data", "Default", "Bookmarks",
          );
        default:
          return path.join(home, ".config", "google-chrome", "Default", "Bookmarks");
      }
    case "safari":
      return process.platform === "darwin" ? path.join(home, "Library", "Safari", "Bookmarks.plist") : "";
    case "firefox":
      return detectFirefoxPlacesPath() ?? "";
  }
}

/** The configured path, or the platform default. Throws a user-friendly error if neither exists. */
export function resolveSourcePath(browser: BrowserType, configured: string): string {
  const custom = expandPath(configured);
  if (custom) return custom;
  const fallback = defaultBrowserPath(browser);
  if (fallback) return fallback;
  throw new BookmarkSourceError(
    `No default ${BROWSER_LABELS[browser]} bookmarks location is known for this platform. ` +
      `Set the file path in the plugin settings.`,
  );
}

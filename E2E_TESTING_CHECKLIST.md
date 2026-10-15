# Bookmarks Sync - End-to-End (E2E) Test Checklist

This document provides a comprehensive end-to-end testing checklist for the **Obsidian Bookmarks Sync** plugin across all supported browsers (**Google Chrome**, **Apple Safari**, and **Mozilla Firefox**).

---

## 🛠️ Test Environment Setup & Preparation

Before beginning E2E testing:

- [ ] **Build & Deploy Latest Plugin Version:**
  ```bash
  npm run build
  ```
  Ensure `main.js`, `manifest.json`, and `styles.css` are in `<Your Vault>/.obsidian/plugins/obsidian-bookmarks-sync/`.
- [ ] **Open Developer Tools in Obsidian:**
  - Press `Cmd + Option + I` (macOS) or `Ctrl + Shift + I` (Windows/Linux) to monitor console logs.
  - Filter console output by `[Bookmarks Sync]`.
- [ ] **Enable Debug Logging in Settings:**
  - Go to **Settings → Community plugins → Bookmarks Sync**.
  - Toggle on **Debug logging** to inspect detailed parsing and sync statistics.
- [ ] **Prepare Test Bookmarks in Each Browser:**
  - Ensure you have a mix of:
    - Root bookmarks (top-level bar/favorites)
    - Subfolders with nested bookmarks (e.g., `Tech/Obsidian/Plugins`)
    - URLs with special characters and query strings (e.g., `https://example.com/search?q=test&page=1`)
    - Titles with punctuation, wikilink chars, and emojis (e.g., `C# & [Rust] ^Guide: "Deep Dive" 🚀`)
    - Bookmarklets (e.g., `javascript:void(0)`) to verify rejection

---

## 🧭 Browser 1: Google Chrome

### 1. Default Location & Profile Detection
- [ ] **Platform Path Auto-Detection:**
  - Leave **Bookmarks file path** empty in settings.
  - Confirm the placeholder shows your OS default:
    - **macOS:** `~/Library/Application Support/Google/Chrome/Default/Bookmarks`
    - **Windows:** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`
    - **Linux:** `~/.config/google-chrome/Default/Bookmarks`
- [ ] **Default Profile Import:**
  - Run command **Bookmarks Sync: Sync bookmarks now**.
  - Check console log: `[Bookmarks Sync] Chrome: parsed N bookmarks`.
  - Notice message displays: `Sync finished: N created, 0 updated, ...`.

### 2. Custom Profile Path (Optional)
- [ ] **Secondary Profile:**
  - Create or locate another Chrome profile (e.g., `Profile 1`).
  - Enter custom path: `~/Library/Application Support/Google/Chrome/Profile 1/Bookmarks` (or Windows/Linux equivalent).
  - Run **Bookmarks Sync: Sync bookmarks now** and verify bookmarks from Profile 1 are imported.

### 3. Folder & URL Validation
- [ ] **Roots Imported:**
  - Check notes created under **Bookmarks Bar**, **Other Bookmarks**, and **Mobile Bookmarks** (if present).
- [ ] **Folder Structure:**
  - Set **Folder structure** to **Mirror browser folders**.
  - Verify vault notes mirror the Chrome folder hierarchy (e.g., `Bookmarks/Bookmarks Bar/Tech/JavaScript.md`).
- [ ] **Bookmarklet Ignored:**
  - Verify bookmarklets with `javascript:` are skipped and not created as notes.
- [ ] **Concurrent Usage:**
  - Keep Chrome actively open and browse while triggering sync in Obsidian.
  - Confirm sync succeeds without file lock conflicts.

---

## 🧭 Browser 2: Apple Safari (macOS)

### 1. Permission & Full Disk Access (FDA)
Safari stores bookmarks in `~/Library/Safari/Bookmarks.plist`, which macOS protects with System Integrity Protection (SIP) / TCC.

- [ ] **Permission Denied Test (Without FDA):**
  - If Obsidian does not yet have Full Disk Access, select **Safari** and click **Sync now**.
  - Verify a clear, actionable error notice appears:
    > *"macOS protects ~/Library/Safari. Grant Obsidian access in System Settings → Privacy & Security → Full Disk Access, then restart Obsidian."*
- [ ] **Grant Full Disk Access:**
  - Open **macOS System Settings → Privacy & Security → Full Disk Access**.
  - Enable **Obsidian** (add it with `+` if not in the list).
  - Restart Obsidian.
- [ ] **Successful Sync with FDA:**
  - Run **Bookmarks Sync: Sync bookmarks now**.
  - Check console log: `[Bookmarks Sync] Safari: parsed N bookmarks`.

### 2. Folder Mapping & Reading List
- [ ] **Favorites Mapping:**
  - Safari's internal `BookmarksBar` folder must be mapped to `Favorites` in Obsidian.
  - Verify notes appear under `Bookmarks/Favorites/...`.
- [ ] **Bookmarks Menu Mapping:**
  - Verify bookmarks in Safari's menu appear under `Bookmarks/Bookmarks Menu/...`.
- [ ] **Reading List Exclusion:**
  - Add test pages to Safari's **Reading List** (`Shift + Cmd + D`).
  - Run **Sync now**.
  - Verify Reading List items are **NOT** imported as bookmarks notes (Safari treats reading list items as a separate plist type).
- [ ] **Date Fallback:**
  - Safari binary plists do not record creation timestamps for regular bookmarks.
  - Verify `{{date}}` placeholder in notes falls back gracefully to the sync date.

---

## 🧭 Browser 3: Mozilla Firefox

Firefox supports two distinct ingestion strategies: live `places.sqlite` database and JSON/jsonlz4 backup archives.

### Mode A: Live Database (`places.sqlite`)
- [ ] **Automatic Profile Detection:**
  - Leave **Firefox path** empty in settings.
  - Verify the plugin automatically finds the most active profile (prefers `*.default-release` in Firefox's profiles directory).
- [ ] **SQLite3 Tool Check:**
  - Ensure `sqlite3` CLI tool is accessible (default in macOS and most Linux distributions).
  - Run **Sync now**.
  - Confirm bookmarks are extracted from `places.sqlite`.
- [ ] **WAL Mode & Concurrent Browser Snapshot:**
  - Launch Firefox and add a new bookmark.
  - Do NOT close Firefox (places.sqlite is actively open with `places.sqlite-wal`).
  - Run **Sync now** in Obsidian.
  - Verify the plugin copies the database and WAL snapshot into a temporary directory and captures the newly added bookmark.
- [ ] **Root Folders & Tag Exclusion:**
  - Verify bookmarks from **Bookmarks Toolbar**, **Bookmarks Menu**, **Other Bookmarks**, and **Mobile Bookmarks** are created.
  - Verify tag virtual folders (`tags________`) and smart query folders (`place:sort=...`) are excluded.

### Mode B: Backup Archives (`*.jsonlz4` / `.json`)
- [ ] **Backup Folder Auto-Detection:**
  - Set **Firefox path** to your Firefox profile directory or `bookmarkbackups` subfolder.
  - Run **Sync now**.
  - Verify the plugin locates the newest `bookmarks-YYYY-MM-DD_*.jsonlz4` and decompresses it using the built-in mozlz4 decompressor without needing `sqlite3`.
- [ ] **Direct JSON Backup:**
  - In Firefox, export bookmarks manually: **Bookmarks → Manage Bookmarks → Import and Backup → Backup...** (or Export to JSON).
  - Set the path in settings to the exported `.json` file.
  - Run **Sync now** and verify all bookmarks import properly.

### Mode C: Custom sqlite3 Path (Windows or Custom Installs)
- [ ] Set **sqlite3 executable** path in settings (e.g., `C:\sqlite3\sqlite3.exe`).
- [ ] Run sync and verify successful execution.

---

## ⚙️ Core Plugin Features E2E Verification

### 1. Template Presets & Note Formatting
- [ ] **Simple Preset:**
  - Set **Template preset** to **Simple**.
  - Note content should only contain: `[https://example.com](https://example.com)`.
- [ ] **Full Preset:**
  - Set **Template preset** to **Full**.
  - Check YAML frontmatter:
    ```yaml
    ---
    title: "Page Title"
    url: "https://example.com"
    folder: "Favorites"
    date: 2024-03-15
    source: Google Chrome
    tags:
      - bookmark
    ---
    ```
  - Verify body contains title header, URL link, and folder breadcrumb.
- [ ] **Custom Template & Filters:**
  - Set **Template preset** to **Custom**.
  - Test custom placeholders and filters:
    ```markdown
    # {{title|upper}}
    Saved on {{date:YYYY-MM-DD HH:mm}} from {{browser}}
    Host: {{domain}}
    ```
  - Verify rendered note has uppercase title, formatted date, browser name, and domain without `www.`.

### 2. Folder Organization Modes
- [ ] **Mirror Browser Folders (`folders`):**
  - Notes are placed in subfolders matching browser bookmarks (e.g. `Bookmarks/Dev/Tool.md`).
- [ ] **Flat Folder (`flat`):**
  - All notes are placed directly in the target folder (`Bookmarks/Tool.md`).
  - If duplicate titles exist, verify suffix hash is added (e.g., `Article (a1b2c3).md`).

### 3. Root Folder Filtering
- [ ] Set **Root folder** to a specific folder name (e.g., `Bookmarks Bar/Work` or `Favorites/Reading`).
- [ ] Run **Sync now**.
- [ ] Verify **only** bookmarks within that sub-tree are imported; other browser folders are ignored.
- [ ] Verify the root prefix is stripped from the note path (does not create redundant nesting).

### 4. Updating & Overwrite Protection
- [ ] **Apply to Existing Notes = OFF (Default):**
  - Add text or notes inside an imported bookmark note in Obsidian.
  - Run **Sync now**.
  - Verify your manual edits are **preserved** and the note is not overwritten (`skipped: 1`).
- [ ] **Apply to Existing Notes = ON:**
  - Toggle on **Apply to existing notes**.
  - Change the template preset.
  - Run **Sync now**.
  - Verify notes are updated with the new template (`updated: N`).

### 5. Note Rename & Move Resilience
- [ ] **Rename a Note in Obsidian:**
  - Rename an imported bookmark note (e.g., `Obsidian.md` → `Obsidian App.md`).
  - Run **Sync now**.
  - Verify the plugin updates its internal index and does **NOT** create a duplicate `Obsidian.md`.
- [ ] **Move a Note/Folder in Obsidian:**
  - Move a bookmark note to another folder in the vault.
  - Run **Sync now**.
  - Verify no duplicate note is created in the original location.

### 6. Automated Sync
- [ ] **Sync on Startup:**
  - Ensure **Sync on startup** is enabled.
  - Reload Obsidian (`Cmd + R` / `Ctrl + R`).
  - Verify automatic sync occurs shortly after load.
- [ ] **Interval Sync:**
  - Set **Automatic sync interval** to `1` minute.
  - Add a new bookmark in your browser.
  - Wait 1 minute and verify new note appears automatically in Obsidian without manual command trigger.
  - Reset interval to `0` (manual only) after testing.

---

## 📋 Test Execution Sign-Off Matrix

| Browser | OS Platform | Mode / Feature | Status (Pass/Fail) | Date Tested | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Google Chrome** | macOS / Win / Linux | Default path sync | ⬜ | | |
| **Google Chrome** | macOS / Win / Linux | Folder hierarchy | ⬜ | | |
| **Google Chrome** | macOS / Win / Linux | Special characters | ⬜ | | |
| **Apple Safari** | macOS | Permission warning | ⬜ | | |
| **Apple Safari** | macOS | Full Disk Access | ⬜ | | |
| **Apple Safari** | macOS | Reading List exclusion | ⬜ | | |
| **Mozilla Firefox**| macOS / Win / Linux | `places.sqlite` (live) | ⬜ | | |
| **Mozilla Firefox**| macOS / Win / Linux | WAL live snapshot | ⬜ | | |
| **Mozilla Firefox**| macOS / Win / Linux | `*.jsonlz4` backup | ⬜ | | |
| **All Browsers** | All | Template presets | ⬜ | | |
| **All Browsers** | All | Note rename tracking | ⬜ | | |
| **All Browsers** | All | Root folder filter | ⬜ | | |
| **All Browsers** | All | Interval sync | ⬜ | | |

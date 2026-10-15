import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/settings";
import { Logger } from "../src/logger";
import type { BookmarkEntry, BookmarkIndex, BookmarkSettings, SyncHost } from "../src/types";

const silentLogger = new Logger(() => false);

function createMockVault() {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  return {
    files,
    folders,
    adapter: {
      async exists(path: string): Promise<boolean> {
        return files.has(path) || folders.has(path);
      },
    },
    getAbstractFileByPath(path: string) {
      if (files.has(path)) {
        const file = new TFile();
        file.path = path;
        file.name = path.split("/").pop() ?? "";
        return file;
      }
      if (folders.has(path)) {
        const folder = new TFolder();
        folder.path = path;
        folder.name = path.split("/").pop() ?? "";
        return folder;
      }
      return null;
    },
    async create(path: string, data: string) {
      if (files.has(path)) throw new Error(`File already exists: ${path}`);
      files.set(path, data);
      const file = new TFile();
      file.path = path;
      return file;
    },
    async createFolder(path: string) {
      folders.add(path);
      const folder = new TFolder();
      folder.path = path;
      return folder;
    },
    async cachedRead(file: TFile) {
      return files.get(file.path) ?? "";
    },
    async process(file: TFile, fn: (data: string) => string) {
      const current = files.get(file.path) ?? "";
      const updated = fn(current);
      files.set(file.path, updated);
      return updated;
    },
  };
}

function createSyncHost(settings: Partial<BookmarkSettings> = {}): { host: SyncHost; vault: ReturnType<typeof createMockVault> } {
  const vault = createMockVault();
  const index: BookmarkIndex = {};
  const mergedSettings: BookmarkSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };

  const host: SyncHost = {
    settings: mergedSettings,
    index,
    log: silentLogger,
    requestIndexSave: () => {},
  };

  return { host, vault };
}

test("SyncEngine creates notes and updates index for new bookmarks", async () => {
  const { host, vault } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    { vault } as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entries: BookmarkEntry[] = [
    {
      sourceId: "1",
      title: "Obsidian",
      url: "https://obsidian.md",
      dateAdded: new Date("2024-01-01"),
      folderPath: ["Favorites"],
      browser: "safari",
    },
  ];

  // We invoke private apply via any or test helper
  const result = await (engine as any).apply(entries);

  assert.equal(result.created, 1);
  assert.equal(result.total, 1);
  assert.equal(result.failed, 0);

  const expectedPath = "Bookmarks/Favorites/Obsidian.md";
  assert.ok(vault.files.has(expectedPath));
  assert.equal(host.index["https://obsidian.md"], expectedPath);
  assert.match(vault.files.get(expectedPath)!, /https:\/\/obsidian\.md/);
});

test("SyncEngine respects folderStructure: 'flat'", async () => {
  const { host, vault } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "flat",
  });

  const engine = new SyncEngine(
    { vault } as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entries: BookmarkEntry[] = [
    {
      sourceId: "2",
      title: "GitHub",
      url: "https://github.com",
      dateAdded: new Date("2024-01-01"),
      folderPath: ["Bookmarks Bar", "Dev Tools"],
      browser: "chrome",
    },
  ];

  await (engine as any).apply(entries);

  // When flat, it goes directly to Bookmarks/GitHub.md
  assert.ok(vault.files.has("Bookmarks/GitHub.md"));
});

test("SyncEngine handles applyToExisting setting", async () => {
  const { host, vault } = createSyncHost({
    targetFolder: "Bookmarks",
    applyToExisting: false,
  });

  const engine = new SyncEngine(
    { vault } as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entry: BookmarkEntry = {
    sourceId: "3",
    title: "Vite",
    url: "https://vitejs.dev",
    dateAdded: new Date("2024-01-01"),
    folderPath: [],
    browser: "chrome",
  };

  // First sync: creates
  const res1 = await (engine as any).apply([entry]);
  assert.equal(res1.created, 1);

  // Second sync with applyToExisting: false -> skipped
  const res2 = await (engine as any).apply([entry]);
  assert.equal(res2.skipped, 1);
  assert.equal(res2.created, 0);

  // Enable applyToExisting: true
  host.settings.applyToExisting = true;
  const res3 = await (engine as any).apply([entry]);
  assert.equal(res3.unchanged, 1); // Content didn't change
});

test("SyncEngine handleRename updates index for files and folders", () => {
  const { host, vault } = createSyncHost();
  const engine = new SyncEngine({ vault } as any, host, () => "");

  host.index["https://a.com"] = "Bookmarks/Dev/Tool.md";
  host.index["https://b.com"] = "Bookmarks/Design/Figma.md";

  // Rename single file
  engine.handleRename("Bookmarks/Dev/Tool.md", "Bookmarks/Dev/SuperTool.md", false);
  assert.equal(host.index["https://a.com"], "Bookmarks/Dev/SuperTool.md");

  // Rename folder
  engine.handleRename("Bookmarks/Design", "Bookmarks/UX", true);
  assert.equal(host.index["https://b.com"], "Bookmarks/UX/Figma.md");
});

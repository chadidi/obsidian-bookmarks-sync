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
        const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (parentPath) {
          const parent = new TFolder();
          parent.path = parentPath;
          parent.name = parentPath.split("/").pop() ?? "";
          file.parent = parent;
        }
        return file;
      }
      if (folders.has(path)) {
        const folder = new TFolder();
        folder.path = path;
        folder.name = path.split("/").pop() ?? "";
        const children: any[] = [];
        for (const f of files.keys()) {
          const p = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
          if (p === path) {
            const cf = new TFile();
            cf.path = f;
            cf.name = f.split("/").pop() ?? "";
            children.push(cf);
          }
        }
        for (const fd of folders) {
          const p = fd.includes("/") ? fd.slice(0, fd.lastIndexOf("/")) : "";
          if (p === path && fd !== path) {
            const cfd = new TFolder();
            cfd.path = fd;
            cfd.name = fd.split("/").pop() ?? "";
            children.push(cfd);
          }
        }
        folder.children = children;
        return folder;
      }
      return null;
    },
    async create(path: string, data: string) {
      if (files.has(path)) throw new Error(`File already exists: ${path}`);
      files.set(path, data);
      const file = new TFile();
      file.path = path;
      file.name = path.split("/").pop() ?? "";
      return file;
    },
    async createFolder(path: string) {
      folders.add(path);
      const folder = new TFolder();
      folder.path = path;
      folder.name = path.split("/").pop() ?? "";
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
    async rename(file: TFile, newPath: string) {
      const data = files.get(file.path);
      if (data !== undefined) {
        files.delete(file.path);
        files.set(newPath, data);
      }
      file.path = newPath;
      file.name = newPath.split("/").pop() ?? "";
      const parentPath = newPath.includes("/") ? newPath.slice(0, newPath.lastIndexOf("/")) : "";
      if (parentPath) {
        const parent = new TFolder();
        parent.path = parentPath;
        parent.name = parentPath.split("/").pop() ?? "";
        file.parent = parent;
      } else {
        file.parent = null;
      }
    },
    async delete(abstractFile: any) {
      files.delete(abstractFile.path);
      folders.delete(abstractFile.path);
    },
    async trash(abstractFile: any, _system: boolean) {
      files.delete(abstractFile.path);
      folders.delete(abstractFile.path);
    },
  };
}

function createSyncHost(settings: Partial<BookmarkSettings> = {}) {
  const vault = createMockVault();
  const fileManager = {
    async renameFile(file: TFile, newPath: string) {
      await vault.rename(file, newPath);
    },
    async trashFile(folder: any) {
      await vault.delete(folder);
    },
  };
  const app = { vault, fileManager };
  const index: BookmarkIndex = {};
  const mergedSettings: BookmarkSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };

  const host: SyncHost = {
    settings: mergedSettings,
    index,
    log: silentLogger,
    requestIndexSave: () => { },
  };

  return { host, vault, app };
}

test("SyncEngine creates notes and updates index for new bookmarks", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    app as any,
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
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "flat",
  });

  const engine = new SyncEngine(
    app as any,
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

test("SyncEngine overwrites existing bookmarks on subsequent sync (1-way sync)", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
  });

  const engine = new SyncEngine(
    app as any,
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

  // Modify file directly in vault to simulate divergence
  vault.files.set("Bookmarks/Vite.md", "custom content");

  // Second sync: always overwrites existing notes with latest template (1-way sync)
  const res2 = await (engine as any).apply([entry]);
  assert.equal(res2.updated, 1);
  assert.equal(res2.created, 0);
  assert.notEqual(vault.files.get("Bookmarks/Vite.md"), "custom content");

  // Third sync with same content: unchanged
  const res3 = await (engine as any).apply([entry]);
  assert.equal(res3.unchanged, 1);
});

test("SyncEngine handleRename updates index for files and folders", () => {
  const { host, app } = createSyncHost();
  const engine = new SyncEngine(app as any, host, () => "");

  host.index["https://a.com"] = "Bookmarks/Dev/Tool.md";
  host.index["https://b.com"] = "Bookmarks/Design/Figma.md";

  // Rename single file
  engine.handleRename("Bookmarks/Dev/Tool.md", "Bookmarks/Dev/SuperTool.md", false);
  assert.equal(host.index["https://a.com"], "Bookmarks/Dev/SuperTool.md");

  // Rename folder
  engine.handleRename("Bookmarks/Design", "Bookmarks/UX", true);
  assert.equal(host.index["https://b.com"], "Bookmarks/UX/Figma.md");
});

test("SyncEngine moves existing notes when folderStructure changes from folders to flat", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entry: BookmarkEntry = {
    sourceId: "1",
    title: "GitHub",
    url: "https://github.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Dev"],
    browser: "chrome",
  };

  // Sync 1: creates note in Bookmarks/Dev/GitHub.md
  const res1 = await (engine as any).apply([entry]);
  assert.equal(res1.created, 1);
  assert.ok(vault.files.has("Bookmarks/Dev/GitHub.md"));
  assert.equal(host.index["https://github.com"], "Bookmarks/Dev/GitHub.md");

  // User changes setting to "flat"
  host.settings.folderStructure = "flat";

  // Sync 2: moves note to Bookmarks/GitHub.md and removes empty Bookmarks/Dev folder
  const res2 = await (engine as any).apply([entry]);
  assert.equal(res2.moved, 1);
  assert.equal(res2.created, 0);
  assert.ok(vault.files.has("Bookmarks/GitHub.md"));
  assert.ok(!vault.files.has("Bookmarks/Dev/GitHub.md"));
  assert.ok(!vault.folders.has("Bookmarks/Dev"));
  assert.equal(host.index["https://github.com"], "Bookmarks/GitHub.md");
});

test("SyncEngine moves existing notes when folderStructure changes from flat to folders", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "flat",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entry: BookmarkEntry = {
    sourceId: "2",
    title: "Docs",
    url: "https://docs.example.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Work", "Projects"],
    browser: "chrome",
  };

  // Sync 1: creates note in flat Bookmarks/Docs.md
  await (engine as any).apply([entry]);
  assert.ok(vault.files.has("Bookmarks/Docs.md"));

  // User changes setting to "folders"
  host.settings.folderStructure = "folders";

  // Sync 2: moves note to Bookmarks/Work/Projects/Docs.md
  const res = await (engine as any).apply([entry]);
  assert.equal(res.moved, 1);
  assert.ok(vault.files.has("Bookmarks/Work/Projects/Docs.md"));
  assert.ok(!vault.files.has("Bookmarks/Docs.md"));
  assert.equal(host.index["https://docs.example.com"], "Bookmarks/Work/Projects/Docs.md");
});

test("SyncEngine moves notes and cleans empty subfolders when browser folderPath changes", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const entry: BookmarkEntry = {
    sourceId: "3",
    title: "Linear",
    url: "https://linear.app",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["OldCategory"],
    browser: "chrome",
  };

  await (engine as any).apply([entry]);
  assert.ok(vault.files.has("Bookmarks/OldCategory/Linear.md"));

  // Bookmark moved to NewCategory in browser
  const updatedEntry: BookmarkEntry = {
    ...entry,
    folderPath: ["NewCategory"],
  };

  const res = await (engine as any).apply([updatedEntry]);
  assert.equal(res.moved, 1);
  assert.ok(vault.files.has("Bookmarks/NewCategory/Linear.md"));
  assert.ok(!vault.files.has("Bookmarks/OldCategory/Linear.md"));
  assert.ok(!vault.folders.has("Bookmarks/OldCategory"));
});

test("SyncEngine handles collision when moving note into folder where name is taken", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  // Two bookmarks with the same title in different browser folders
  const entryA: BookmarkEntry = {
    sourceId: "4",
    title: "Tool",
    url: "https://tool-a.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["FolderA"],
    browser: "chrome",
  };
  const entryB: BookmarkEntry = {
    sourceId: "5",
    title: "Tool",
    url: "https://tool-b.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["FolderB"],
    browser: "chrome",
  };

  await (engine as any).apply([entryA, entryB]);
  assert.ok(vault.files.has("Bookmarks/FolderA/Tool.md"));
  assert.ok(vault.files.has("Bookmarks/FolderB/Tool.md"));

  // Change to flat: both notes now target Bookmarks/
  host.settings.folderStructure = "flat";
  const res = await (engine as any).apply([entryA, entryB]);
  assert.equal(res.moved, 2);

  // One gets Tool.md, the other gets disambiguated with hash suffix
  const files = Array.from(vault.files.keys());
  assert.ok(files.some((f) => f === "Bookmarks/Tool.md"));
  assert.ok(files.some((f) => f.startsWith("Bookmarks/Tool (") && f.endsWith(").md")));
});

test("SyncEngine deletes notes for bookmarks removed from the browser", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "folders",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const kept: BookmarkEntry = {
    sourceId: "1",
    title: "Keep",
    url: "https://keep.example.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Work"],
    browser: "chrome",
  };
  const gone: BookmarkEntry = {
    sourceId: "2",
    title: "Gone",
    url: "https://gone.example.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Work"],
    browser: "chrome",
  };

  const res1 = await (engine as any).apply([kept, gone]);
  assert.equal(res1.created, 2);
  assert.ok(vault.files.has("Bookmarks/Work/Gone.md"));

  // Browser no longer returns `gone`.
  const res2 = await (engine as any).apply([kept]);
  assert.equal(res2.removed, 1);
  assert.equal(host.index["https://gone.example.com"], undefined);
  assert.ok(!vault.files.has("Bookmarks/Work/Gone.md"));
  assert.ok(vault.files.has("Bookmarks/Work/Keep.md"));
});

test("SyncEngine keeps notes for bookmarks filtered out by rootFolder", async () => {
  const { host, vault, app } = createSyncHost({
    targetFolder: "Bookmarks",
    folderStructure: "flat",
  });

  const engine = new SyncEngine(
    app as any,
    host,
    (date) => date.toISOString().slice(0, 10),
  );

  const inScope: BookmarkEntry = {
    sourceId: "1",
    title: "InScope",
    url: "https://in.example.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Work"],
    browser: "chrome",
  };
  const outOfScope: BookmarkEntry = {
    sourceId: "2",
    title: "OutOfScope",
    url: "https://out.example.com",
    dateAdded: new Date("2024-01-01"),
    folderPath: ["Personal"],
    browser: "chrome",
  };

  // Initial sync with no root filter imports both.
  await (engine as any).apply([inScope, outOfScope]);
  assert.ok(vault.files.has("Bookmarks/OutOfScope.md"));

  // A root folder now filters out `outOfScope`, but it still exists in the browser
  // (present in the unfiltered entries), so its note must survive.
  host.settings.rootFolder = "Work";
  const res = await (engine as any).apply([inScope], [inScope, outOfScope]);
  assert.equal(res.removed, 0);
  assert.equal(host.index["https://out.example.com"], "Bookmarks/OutOfScope.md");
  assert.ok(vault.files.has("Bookmarks/OutOfScope.md"));
});


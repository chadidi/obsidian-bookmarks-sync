/**
 * In-memory mock for Obsidian API to allow standalone unit testing in Node.js.
 */

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
  vault: any = null;
}

export class TFile extends TAbstractFile {
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  basename = "";
  extension = "md";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.path === "" || this.path === "/";
  }
}

export class Notice {
  constructor(public message: string | DocumentFragment, public duration?: number) {}
}

export class Plugin {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
}

export class PluginSettingTab {
  icon = "";
  constructor(public app: any, public plugin: any) {}
  display(): void {}
  hide(): void {}
}

export function setIcon(_parent: any, _icon: string): void {}

export class Setting {
  constructor(public containerEl: any) {}
  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  addText(cb: (comp: any) => any): this {
    cb({
      setPlaceholder: () => this,
      setValue: () => this,
      onChange: () => this,
      inputEl: {},
    });
    return this;
  }
  addToggle(cb: (comp: any) => any): this {
    cb({
      setValue: () => this,
      onChange: () => this,
    });
    return this;
  }
  addDropdown(cb: (comp: any) => any): this {
    cb({
      addOption: () => this,
      setValue: () => this,
      onChange: () => this,
      selectEl: {},
    });
    return this;
  }
  addButton(cb: (comp: any) => any): this {
    cb({
      setButtonText: () => this,
      setCta: () => this,
      onClick: () => this,
      buttonEl: {},
    });
    return this;
  }
  addTextArea(cb: (comp: any) => any): this {
    cb({
      setPlaceholder: () => this,
      setValue: () => this,
      onChange: () => this,
      inputEl: {},
    });
    return this;
  }
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeout: any;
  const debounced = (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
  return debounced as unknown as T;
}

export function moment(date?: any) {
  const d = date ? new Date(date) : new Date();
  return {
    format(fmt: string) {
      if (fmt === "YYYY-MM-DD") return d.toISOString().slice(0, 10);
      if (fmt === "YYYY-MM-DD HH:mm") return d.toISOString().slice(0, 16).replace("T", " ");
      return d.toISOString();
    },
  };
}

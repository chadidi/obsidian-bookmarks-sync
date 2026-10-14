const PREFIX = "[Browser Bookmarks Sync]";

export class Logger {
  constructor(private readonly isDebug: () => boolean) {}

  debug(...args: unknown[]): void {
    if (this.isDebug()) console.debug(PREFIX, ...args);
  }
  info(...args: unknown[]): void {
    if (this.isDebug()) console.debug(PREFIX, ...args);
  }
  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  }
  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  }
}

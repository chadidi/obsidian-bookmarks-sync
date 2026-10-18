import { register } from 'node:module';

// Mock window for tests so sources can use window.require without crashing.
globalThis.window = globalThis;

register('./obsidian-loader.mjs', import.meta.url);

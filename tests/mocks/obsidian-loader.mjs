import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { templatesModuleSource } from '../../scripts/templates-module.mjs';

const VIRTUAL_TEMPLATES = 'virtual:templates';

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'obsidian') {
    return {
      format: 'module',
      shortCircuit: true,
      url: new URL('./obsidian.ts', import.meta.url).href,
    };
  }
  if (specifier === VIRTUAL_TEMPLATES) {
    return { format: 'module', shortCircuit: true, url: VIRTUAL_TEMPLATES };
  }
  // The virtual module imports templates by absolute path; a bare absolute path is
  // not a valid URL for a non-hierarchical scheme, so normalize it to a file URL.
  if (specifier.endsWith('.md') && (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier))) {
    return { format: 'module', shortCircuit: true, url: pathToFileURL(specifier).href };
  }
  return nextResolve(specifier, context);
}

/** Mirrors the esbuild config: templates are inlined from the templates folder, .md files import as text. */
export async function load(url, context, nextLoad) {
  // Loaders in the chain may append a cache-busting query, so match on the prefix only.
  if (url.startsWith(VIRTUAL_TEMPLATES)) {
    return { format: 'module', shortCircuit: true, source: templatesModuleSource() };
  }
  if (url.endsWith('.md')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }
  return nextLoad(url, context);
}

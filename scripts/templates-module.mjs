import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder holding one markdown file per built-in template. */
export const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
);

/** Every template file in the folder, sorted by template name. */
function readTemplateFiles() {
  return readdirSync(TEMPLATES_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      name: path.basename(fileName, path.extname(fileName)),
      file: path.join(TEMPLATES_DIR, fileName),
    }));
}

/** Import specifiers use forward slashes so they stay valid on every platform. */
function toImportSpecifier(file) {
  return file.split(path.sep).join('/');
}

/**
 * Source of the virtual module that inlines every templates/*.md into the build. The files are
 * imported rather than read here, so esbuild and the test runner both reuse their existing
 * markdown text handling, and editing a template rebuilds the bundle.
 */
export function templatesModuleSource() {
  const files = readTemplateFiles();
  const imports = files.map(
    (template, index) => `import template${index} from ${JSON.stringify(toImportSpecifier(template.file))};`,
  );
  const entries = files.map((template, index) => `  ${JSON.stringify(template.name)}: template${index},`);
  return `${imports.join('\n')}\nexport const TEMPLATES = {\n${entries.join('\n')}\n};\n`;
}

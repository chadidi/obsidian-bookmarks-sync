import { TEMPLATES } from 'virtual:templates';

/**
 * Built-in templates, inlined from the markdown files in the templates folder at build time.
 * Every file in that folder becomes a template named after it, so adding templates/<name>.md
 * is enough. Nothing is read from disk at runtime.
 */
export { TEMPLATES };

/** Names of the built-in templates, in dropdown order. */
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/** Selection value that switches rendering to the free-form template editor in settings. */
export const CUSTOM_TEMPLATE_ID = 'custom';

/** Used when the selected template is missing or empty. For now, the simple template. */
export const DEFAULT_TEMPLATE: string = TEMPLATES.simple || Object.values(TEMPLATES)[0] || '';

/** Body of the template selected in settings, with the custom body when Custom is selected. */
export function resolveTemplate(settings: {
  templateName: string;
  customTemplate: string;
}): string {
  if (settings.templateName === CUSTOM_TEMPLATE_ID) {
    return settings.customTemplate.trim() ? settings.customTemplate : DEFAULT_TEMPLATE;
  }
  const body = TEMPLATES[settings.templateName];
  return body && body.trim() ? body : DEFAULT_TEMPLATE;
}

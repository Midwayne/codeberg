export const EXTENSION_NAME_PATTERN = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';

export const EXTENSION_NAME = new RegExp(`^${EXTENSION_NAME_PATTERN}$`);

export const SKILL_MAX_BYTES = 256 * 1024;

export const SKILL_SIZE_LABEL = `${SKILL_MAX_BYTES / 1024} KB`;

export const MAX_SKILL_FILES = 20;

export function validExtensionName(name: string): boolean {
  return EXTENSION_NAME.test(name);
}

export function skillFileCountError(): string {
  return `Choose between 1 and ${MAX_SKILL_FILES} skill files.`;
}

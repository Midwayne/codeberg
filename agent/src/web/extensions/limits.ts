export const EXTENSION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const SKILL_MAX_BYTES = 256 * 1024;

export const SKILL_SIZE_LABEL = `${SKILL_MAX_BYTES / 1024} KB`;

export function validExtensionName(name: string): boolean {
  return EXTENSION_NAME.test(name);
}

export function withinSkillLimit(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') <= SKILL_MAX_BYTES;
}

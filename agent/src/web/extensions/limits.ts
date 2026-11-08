import { SKILL_MAX_BYTES } from '../../core/context/skill-limits.js';

export function withinSkillLimit(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') <= SKILL_MAX_BYTES;
}

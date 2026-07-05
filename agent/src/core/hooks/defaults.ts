import { enhancePromptHook } from './enhance.js';
import type { PromptHook } from './types.js';

export const DEFAULT_PROMPT_HOOKS: readonly PromptHook[] = [enhancePromptHook];

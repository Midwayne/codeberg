import type { ModelMessage } from 'ai';

/** Sent with the last step of a budgeted turn, when tools are no longer offered. */
const FINAL_ANSWER_REQUEST = 'This turn has used its step budget. Do not call tools. Answer now from what you ' +
  'found, and say what remains unchecked.';

/**
 * An optional cap on model steps per chat turn (CODEBERG_MAX_TURN_STEPS),
 * for unattended runs such as scheduled wake-ups and scripts. Unset (the
 * default), a turn works until it answers or the user presses Stop.
 */
export function turnMaxSteps(env: NodeJS.ProcessEnv): number | undefined {
  const value = env.CODEBERG_MAX_TURN_STEPS?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;

  const steps = Number(value);

  return Number.isSafeInteger(steps) && steps >= 2 ? steps : undefined;
}

/** On the budget's last step, take tools away and ask for the answer. */
export function finalStep(stepNumber: number, maxSteps: number | undefined, messages: ModelMessage[]) {
  if (maxSteps === undefined || stepNumber < maxSteps - 1) return undefined;

  return { toolChoice: 'none' as const, messages: [...messages, { role: 'user' as const, content: FINAL_ANSWER_REQUEST }] };
}

import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

import { applyProfileUpdate } from './apply.js';
import { validateProfileUpdate } from './response.js';
import type { ProfileStore } from './store.js';
import { PROFILE_KINDS, type ProfileKind } from './types.js';

type RememberInput = { kind: ProfileKind; statement: string; evidence: string; replaces?: string };

export const REMEMBER_INSTRUCTIONS = `

Memory: when the user asks you to remember, always do, or stop doing something, or states a lasting preference, workflow, convention, ongoing decision or where to find something, call remember right away with the user's exact words as evidence. When they say a remembered note is wrong or ask you to forget it, call forget with its id from "How this user works". Do not remember facts you can read from the code, task state, one-off details, or anything that is not in the user's own words.`;

/** Explicit, user-directed memory. Evidence must quote a user message, never a tool result. */
export function rememberTools(profile: ProfileStore): ToolSet {
  return {
    remember: tool({
      description:
        'Save a lasting note about how the user works so future chats follow it. evidence must be an exact excerpt of a user message in this chat.',
      inputSchema: rememberSchema,
      execute: async (input, { messages, toolCallId }) =>
        remember(profile, input, messages, toolCallId),
    }),
    forget: tool({
      description:
        'Delete a remembered note by its id when the user says it is wrong or asks to forget it.',
      inputSchema: forgetSchema,
      execute: async ({ id }) =>
        (await profile.remove(id)) ? { forgotten: id } : { error: `no remembered note ${id}` },
    }),
  };
}

async function remember(
  profile: ProfileStore,
  input: RememberInput,
  messages: ModelMessage[],
  toolCallId: string,
) {
  const entry = { kind: input.kind, statement: input.statement, evidence: input.evidence };
  const update = validateProfileUpdate(
    {
      add: input.replaces ? [] : [entry],
      update: input.replaces ? [{ id: input.replaces, ...entry }] : [],
    },
    userMessages(messages),
  );

  if (!update.add.length && !update.update.length)
    return {
      error:
        'Not saved: evidence must quote the user exactly, and the note must not contain personal identifiers.',
    };

  const notes = await profile.update((current) =>
    applyProfileUpdate(current, update, `chat:${toolCallId}`, new Date().toISOString()),
  );
  const saved = notes.find(
    (note) => note.statement === (update.add[0] ?? update.update[0]).statement,
  );

  return { saved: saved?.id, statement: saved?.statement, applies: 'this chat and all new chats' };
}

function userMessages(messages: ModelMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user') return [];

    if (typeof message.content === 'string') return [message.content];

    return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
  });
}

const rememberSchema = jsonSchema<RememberInput>({
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: [...PROFILE_KINDS] },
    statement: {
      type: 'string',
      description: 'Short third-person note, e.g. "Wants the SQL shown with results".',
    },
    evidence: { type: 'string', description: "Exact excerpt of the user's message." },
    replaces: { type: 'string', description: 'Id of a remembered note this corrects, if any.' },
  },
  required: ['kind', 'statement', 'evidence'],
});

const forgetSchema = jsonSchema<{ id: string }>({
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string' } },
  required: ['id'],
});

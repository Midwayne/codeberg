import { jsonSchema, tool, type ToolSet } from 'ai';

import { callerScope } from '../background/context.js';
import type { ToolSource } from '../tools/source.js';
import { addEntries, retireEntry } from './entries.js';
import { MAX_PATTERN_CHARS, queryWorklist, type ReadInput } from './query.js';
import { currentWorklistPath, readWorklist, updateWorklist } from './store.js';
import { MAX_ADD_ITEMS, MAX_ENTRY_CHARS, MAX_WORKLIST_ENTRIES, type NewEntry } from './types.js';

export const WORKLIST_TOOL_NAMES = ['worklist_add', 'worklist_read', 'worklist_retire'] as const;

/** System-prompt guidance added whenever the working list is offered. */
export const WORKLIST_INSTRUCTIONS = `

Working list: this chat keeps a working list of facts that must not be lost, even when older history is summarized. Call worklist_add as soon as you confirm a finding (with its [path:start-end] citation), learn a constraint or decision the user gave, or settle a plan step; record each as one short, self-contained statement. Call worklist_read before answering a long or multi-step task, after earlier history was summarized, and when a scheduled or woken turn starts; pass pattern to grep it. When an entry proves wrong or stops applying, call worklist_retire with a correction instead of contradicting it silently. Entries are your notes, not evidence: re-read the code before citing a finding that may have changed.`;

type AddInput = { items: NewEntry[] };
type RetireInput = { id: string; reason?: string; correction?: string };

export function worklistToolSource(): ToolSource {
  return { name: 'worklist', tools: worklistTools };
}

export function worklistTools(): ToolSet {
  return {
    worklist_add: tool({
      description: `Record findings, facts, user constraints, or decisions on this chat's working list so they survive history summaries. Up to ${MAX_ADD_ITEMS} items per call, each under ${MAX_ENTRY_CHARS} characters; optional tags group them (e.g. "finding", "constraint", "todo"). Text already on the list is not duplicated. Returns each entry's id.`,
      inputSchema: addSchema,
      execute: ({ items }) => updateWorklist(currentWorklistPath(), (data) =>
        addEntries(data, items, callerScope.getStore(), new Date().toISOString())),
    }),
    worklist_read: tool({
      description: `Read this chat's working list in the order entries were recorded. pattern greps entry text and tags (case-insensitive substring; regex: true for a regular expression); tag keeps one tag; include_retired also shows retired entries and their corrections.`,
      inputSchema: readSchema,
      execute: async (input) => queryWorklist(await readWorklist(currentWorklistPath()), input),
    }),
    worklist_retire: tool({
      description: 'Retire a working-list entry that turned out wrong or no longer applies. Give a short reason, and a correction to record the right statement as a new linked entry. Retired entries stay readable with include_retired.',
      inputSchema: retireSchema,
      execute: (input) => updateWorklist(currentWorklistPath(), (data) =>
        retireEntry(data, input, callerScope.getStore(), new Date().toISOString())),
    }),
  };
}

const addSchema = jsonSchema<AddInput>({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_ADD_ITEMS,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: MAX_ENTRY_CHARS },
          tags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
});

const readSchema = jsonSchema<ReadInput>({
  type: 'object',
  properties: {
    pattern: { type: 'string', maxLength: MAX_PATTERN_CHARS },
    regex: { type: 'boolean' },
    tag: { type: 'string' },
    include_retired: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_WORKLIST_ENTRIES },
  },
  additionalProperties: false,
});

const retireSchema = jsonSchema<RetireInput>({
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    reason: { type: 'string' },
    correction: { type: 'string', minLength: 1, maxLength: MAX_ENTRY_CHARS },
  },
  required: ['id'],
  additionalProperties: false,
});

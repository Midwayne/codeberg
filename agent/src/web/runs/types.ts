import type { UIMessage, UIMessageChunk } from 'ai';
import type { ToolObservation } from '../../core/runs/tools.js';
import type { ResolvedModelSelection } from '../chat-routes.js';
import type { RunJournal } from './journal.js';

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';

export interface RunInput {
  chatId: string;
  requestId: string;
  messages: UIMessage[];
  selection?: ResolvedModelSelection;
  trigger?: string;
}

export interface RunRecord extends RunInput {
  id: string;
  fingerprint: string;
  status: RunStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}

/** A journaled tool call, exactly as the agent records it. */
export type ToolEntry = ToolObservation;

export type JournalEntry = ToolEntry | { kind: 'chunk'; chunk: UIMessageChunk };

export interface SearchRun {
  record: RunRecord;
  journal: RunJournal;
  events: UIMessageChunk[];
  tools: ToolEntry[];
  controller: AbortController;
  listeners: Set<() => void>;
  done: Promise<void>;
  settled?: boolean;
}

export type ChatGenerator = (options: {
  messages: UIMessage[];
  selection?: ResolvedModelSelection;
  signal: AbortSignal;
  runId: string;
}) => Promise<{ stream: ReadableStream<UIMessageChunk>; close?: () => Promise<void> }>;

export class RunError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

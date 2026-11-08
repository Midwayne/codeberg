import type { UIMessage, UIMessageChunk } from 'ai';
import type { RunStatus, ToolObservation } from '../../core/api/runs.js';
import type { ResolvedModelSelection } from '../chat-routes.js';
import type { RunJournal } from './journal.js';

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

export type JournalEntry = ToolObservation | { kind: 'chunk'; chunk: UIMessageChunk };

export interface SearchRun {
  record: RunRecord;
  journal: RunJournal;
  events: UIMessageChunk[];
  tools: ToolObservation[];
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

import { DefaultChatTransport, type ChatTransport, type UIMessage } from 'ai';
import type { Chat } from '@ai-sdk/react';
import { reconnectingStream, retryAdmission } from './run-reconnect';

type Submission = Parameters<ChatTransport<UIMessage>['sendMessages']>[0];

/** Request identity belongs to a submission; cancelling a subscription never sends Stop. */
export class RunTransport implements ChatTransport<UIMessage> {
  private readonly delegate: DefaultChatTransport<UIMessage>;
  private runId?: string;
  private requestId?: string;
  private after = 0;
  private opening?: Promise<unknown>;
  private signal?: AbortSignal;
  private messages?: () => UIMessage[];
  private submission?: Submission;
  private replaying = false;

  constructor(private readonly api: typeof fetch = fetch,
    private readonly wait = () => new Promise<void>((resolve) => setTimeout(resolve, 500))) {
    this.delegate = new DefaultChatTransport({ api: '/api/chat', fetch: async (input, init) => {
      const response = await this.api(input, { ...init, signal: this.signal ?? init?.signal });
      const runId = response.headers.get('x-codeberg-run');
      if (runId) this.runId = runId;

      return response;
    }, prepareReconnectToStreamRequest: ({ id }) => ({ api: this.reconnectUrl(id) }) });
  }

  sendMessages: ChatTransport<UIMessage>['sendMessages'] = async (request) => {
    if (this.replaying) return this.replayStream(request);

    this.signal = request.abortSignal;
    this.after = 0;
    this.runId = undefined;
    this.requestId = crypto.randomUUID();
    const body = { ...request.body, requestId: this.requestId };
    this.submission = { ...request, messages: structuredClone(request.messages), body: structuredClone(body) };

    return this.admit(request.abortSignal);
  };

  reconnectToStream: ChatTransport<UIMessage>['reconnectToStream'] = async (request) => {
    const signal = (request as typeof request & { abortSignal?: AbortSignal }).abortSignal;
    this.signal = signal;
    const state = await this.prepareResume(request.chatId);
    if (state === 'missing' && !this.runId && this.submission) return this.admit(signal);
    if (state !== 'resume') return null;

    const stream = await this.delegate.reconnectToStream(request);

    return stream ? this.follow(stream, request.chatId, signal) : null;
  };

  bindMessages(read: () => UIMessage[]): void {
    this.messages = read;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }

  private async prepareResume(chatId: string): Promise<'missing' | 'idle' | 'resume'> {
    const response = await this.api(this.statusUrl(chatId));
    if (response.status === 404) return 'missing';
    if (!response.ok) throw new Error('Could not reconnect to the search. Try again.');

    const run = await response.json() as { id: string; status: string; requestId?: string; messageId?: string; eventCount: number };
    this.checkOwnership(run);
    const fresh = !this.runId;
    if (run.status !== 'running' && this.messages?.().at(-1)?.id === run.messageId
      && (fresh || this.after >= run.eventCount)) return 'idle';

    if (fresh) {
      this.runId = run.id;
      this.after = 0;
    }

    return 'resume';
  }

  async stop(chatId: string): Promise<void> {
    await this.opening?.catch(() => undefined);
    const response = await this.api(`/api/chat/${encodeURIComponent(chatId)}/stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.runId ? { runId: this.runId } : { requestId: this.requestId }),
    });
    if (!response.ok) throw new Error('Could not stop the server search. Reconnect and try Stop again.');
  }

  async retry(chat: Pick<Chat<UIMessage>, 'id' | 'messages' | 'resumeStream' | 'regenerate'>): Promise<void> {
    const response = await this.api(this.statusUrl(chat.id));
    if (response.status === 404 && !this.runId && this.submission) {
      await chat.resumeStream();
      return;
    }
    if (!response.ok) throw new Error('Could not read the search status. Reload this chat.');

    const run = await response.json() as { id: string; status: string; requestId?: string };
    this.checkOwnership(run);
    if (run.status === 'running' || run.status === 'completed') {
      this.runId = run.id;
      await this.replay(chat);
    } else {
      this.after = 0;
      await chat.regenerate();
    }
  }

  /** Regenerate resets SDK parser state; its transport request only replays the saved run. */
  private async replay(chat: Pick<Chat<UIMessage>, 'messages' | 'regenerate'>): Promise<void> {
    const messages = chat.messages;
    this.replaying = true;
    try {
      await chat.regenerate();
    } finally {
      this.replaying = false;
      // Keep the previous partial answer if opening the replay failed before any events.
      if (chat.messages.length < messages.length) chat.messages = messages;
    }
  }

  private async replayStream(request: Submission) {
    this.signal = request.abortSignal;
    this.after = 0;
    const stream = await this.delegate.reconnectToStream({ chatId: request.chatId });
    if (!stream) throw new Error('Search run is unavailable. Reload the chat.');

    return this.follow(stream, request.chatId, request.abortSignal);
  }

  /** Replace partial client state only after its stopped subscription has settled. */
  async synchronize(chat: Pick<Chat<UIMessage>, 'id' | 'messages'>): Promise<void> {
    const response = await this.api(`/api/sessions/${encodeURIComponent(chat.id)}`);
    if (!response.ok) throw new Error('Search stopped, but its saved history could not be loaded. Retry before continuing.');

    const record = await response.json() as { messages: UIMessage[] };
    chat.messages = record.messages;
  }

  private async admit(signal?: AbortSignal) {
    if (!this.submission) throw new Error('No pending submission. Reload this chat.');

    const request = { ...this.submission, abortSignal: signal };
    const opening = retryAdmission(() => this.delegate.sendMessages(request), this.wait, signal);
    this.opening = opening;
    const stream = await opening;

    return this.follow(stream, request.chatId, signal);
  }

  private statusUrl(chatId: string): string {
    const identity = this.runId ? `runId=${encodeURIComponent(this.runId)}`
      : this.requestId ? `requestId=${encodeURIComponent(this.requestId)}` : '';

    return `/api/chat/${encodeURIComponent(chatId)}/run${identity ? `?${identity}` : ''}`;
  }

  private checkOwnership(run: { requestId?: string }): void {
    if (this.requestId && !this.runId && run.requestId !== this.requestId) {
      throw new Error('Chat changed in another tab. Reload it before continuing.');
    }
  }

  private reconnectUrl(chatId: string): string {
    const query = this.runId ? `runId=${encodeURIComponent(this.runId)}&after=${this.after}` : 'after=0';

    return `/api/chat/${encodeURIComponent(chatId)}/stream?${query}`;
  }

  private follow(stream: ReadableStream<import('ai').UIMessageChunk>, chatId: string, signal?: AbortSignal) {
    return reconnectingStream(stream, { signal, wait: this.wait, consumed: () => {
      this.after++;
    },
      reconnect: () => this.delegate.reconnectToStream({ chatId }),
    });
  }
}

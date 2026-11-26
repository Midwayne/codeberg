import type { ChatTransport, UIMessage } from 'ai';

import type { ModelSelection } from '../lib/models';

/** One chat's own model; `null` follows the default chat model from Models. */
export class ChatModelChoice {
  private value: ModelSelection | null;
  private listeners = new Set<() => void>();

  constructor(value: ModelSelection | null = null) {
    this.value = value;
  }

  get current(): ModelSelection | null {
    return this.value;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  set(value: ModelSelection | null): void {
    if (sameChoice(this.value, value)) return;

    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}

function sameChoice(a: ModelSelection | null, b: ModelSelection | null): boolean {
  return a?.key === b?.key && a?.effort === b?.effort;
}

/** Each request names the chat's own model, read when the message is sent. */
export function chatModelTransport(
  transport: ChatTransport<UIMessage>,
  choice: ChatModelChoice,
): ChatTransport<UIMessage> {
  return {
    sendMessages: (request) => {
      const model = choice.current;
      const body = model ? { ...request.body, model } : request.body;

      return transport.sendMessages({ ...request, body });
    },
    reconnectToStream: (request) => transport.reconnectToStream(request),
  };
}

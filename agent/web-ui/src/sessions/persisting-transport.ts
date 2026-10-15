import type { ChatTransport, UIMessage } from 'ai';

/** Make the chat discoverable before a model request can start or fail. */
export function persistingTransport(
  transport: ChatTransport<UIMessage>,
  save: (messages: UIMessage[]) => Promise<void>,
): ChatTransport<UIMessage> {
  return {
    sendMessages: async (request) => {
      // Saving reports its own recoverable error; generation can still proceed.
      await save(request.messages).catch(() => undefined);
      request.abortSignal?.throwIfAborted();

      return transport.sendMessages(request);
    },
    reconnectToStream: (request) => transport.reconnectToStream(request),
  };
}

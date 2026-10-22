import type { ChatTransport, UIMessage } from 'ai';

/** Make the chat discoverable before a model request can start or fail. */
export function persistingTransport(
  transport: ChatTransport<UIMessage>,
  save: (messages: UIMessage[]) => Promise<void>,
): ChatTransport<UIMessage> & { isPending: () => boolean } {
  let pending = false;

  return {
    isPending: () => pending,
    sendMessages: async (request) => {
      pending = true;
      try {
        // Saving reports its own recoverable error; generation can still proceed.
        await waitForSave(save(request.messages).catch(() => undefined), request.abortSignal);
        request.abortSignal?.throwIfAborted();
      } finally {
        pending = false;
      }

      return transport.sendMessages(request);
    },
    reconnectToStream: (request) => transport.reconnectToStream(request),
  };
}

/** Cancelling a local submission need not wait for its history write to finish. */
async function waitForSave(save: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return save;

  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([save, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

import type { UIMessageChunk } from 'ai';

type ReconnectOptions = {
  reconnect: () => Promise<ReadableStream<UIMessageChunk> | null>;
  consumed: () => void;
  wait: () => Promise<void>;
  signal?: AbortSignal;
};

type Connection = { reader: ReadableStreamDefaultReader<UIMessageChunk>; cancelled: boolean; attempts: number };

/** Keep one SDK stream alive across transport failures so text/tool parser state is retained. */
export function reconnectingStream(initial: ReadableStream<UIMessageChunk>, options: ReconnectOptions): ReadableStream<UIMessageChunk> {
  const connection: Connection = { reader: initial.getReader(), cancelled: false, attempts: 0 };
  let terminal = false;

  return new ReadableStream({
    async pull(controller) {
      while (!connection.cancelled) {
        try {
          const next = await connection.reader.read();
          if (next.done) {
            if (!terminal) throw new TypeError('Search connection ended before completion.');

            controller.close();
            return;
          }
          terminal ||= ['finish', 'abort', 'error'].includes(next.value.type);
          options.consumed();
          controller.enqueue(next.value);
          return;
        } catch (error) {
          if (connection.cancelled) return;
          if (terminal) {
            controller.close();
            return;
          }
          await reconnect(connection, options, error);
        }
      }
    },
    async cancel() {
      connection.cancelled = true;
      await connection.reader.cancel();
    },
  });
}

async function reconnect(connection: Connection, options: ReconnectOptions, failure: unknown): Promise<void> {
  while (!connection.cancelled) {
    if (options.signal?.aborted || connection.attempts++ >= 3) throw failure;

    await options.wait();
    if (connection.cancelled) return;

    options.signal?.throwIfAborted();
    try {
      const stream = await options.reconnect();
      if (!stream) throw new Error('Search run is unavailable. Reload the chat.');

      if (connection.cancelled) {
        await stream.cancel();
        return;
      }
      connection.reader.releaseLock();
      connection.reader = stream.getReader();
      return;
    } catch (error) {
      failure = error;
    }
  }
}

export async function retryAdmission<T>(call: () => Promise<T>, wait: () => Promise<void>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= 3 || signal?.aborted) throw error;

      await wait();
    }
  }
}

import { createHash } from 'node:crypto';

/** Hash binary content before serialization; never expand attachment buffers
 *  into JSON arrays containing millions of byte values. */
export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Cache annotations are transport metadata. Business data inside tool inputs
 *  and JSON outputs, including fields named providerOptions, remains significant. */
export function fingerprintMessage(value: unknown): string {
  const message = withoutHints(value);
  if (Array.isArray(message.content)) message.content = message.content.map(cleanPart);

  return hash(canonical(message));
}

const promptPrints = new WeakMap<readonly unknown[], readonly string[]>();

/**
 * Fingerprints of every message in a prompt, computed once per prompt array.
 * Checkpoint restore, the budget estimate and usage recording all see the same
 * array within a model step. Prompts are rebuilt, never edited in place, so an
 * array's fingerprints cannot go stale.
 */
export function promptFingerprints(prompt: readonly unknown[]): readonly string[] {
  let prints = promptPrints.get(prompt);
  if (!prints) {
    prints = prompt.map(fingerprintMessage);
    promptPrints.set(prompt, prints);
  }

  return prints;
}

/** Chained prefix keys: entry i identifies messages[0..i] as a whole. */
export function prefixHashes(messages: readonly unknown[]): string[] {
  let previous = '';

  return promptFingerprints(messages).map((print) => {
    previous = hash(previous + print);

    return previous;
  });
}

function cleanPart(value: unknown): Record<string, unknown> {
  if ((value as Record<string, unknown>).type === 'custom') return value as Record<string, unknown>;

  const part = withoutHints(value);
  if (part.type !== 'tool-result') return part;

  const output = withoutHints(part.output);
  if (output.type === 'content' && Array.isArray(output.value)) {
    output.value = output.value.map(cleanPart);
  }
  part.output = output;

  return part;
}

function withoutHints(value: unknown): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const options = record.providerOptions as Record<string, unknown> | undefined;
  const anthropic = options?.anthropic as Record<string, unknown> | undefined;
  if (!anthropic || !('cacheControl' in anthropic)) return { ...record };

  const { cacheControl: _cache, ...remaining } = anthropic;
  const { anthropic: _old, ...providers } = options!;
  if (Object.keys(remaining).length > 0) providers.anthropic = remaining;

  const { providerOptions: _metadata, ...rest } = record;

  return Object.keys(providers).length ? { ...rest, providerOptions: providers } : rest;
}

function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return { binaryHash: hash(value), bytes: value.byteLength };

  if (value instanceof ArrayBuffer) return { binaryHash: hash(new Uint8Array(value)), bytes: value.byteLength };

  if (value instanceof URL) return value.href;

  if (value instanceof Date) return value.toJSON();

  if (Array.isArray(value)) return value.map(normalize);

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
  }

  return value;
}

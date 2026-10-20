import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

import { MAX_FILE_BYTES, MAX_SEGMENT_CHARS, safeCut } from './limits.js';

export interface TextSegment {
  line: number;
  column: number;
  text: string;
  end: boolean;
}

interface ScanState {
  pending: string;
  line: number;
  column: number;
}

export class ContextReadError extends Error {}

/** Stream text in bounded segments, including a final empty line after '\n'. */
export async function* textSegments(file: string): AsyncGenerator<TextSegment> {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new ContextReadError();

  const state: ScanState = { pending: '', line: 1, column: 1 };
  const decoder = new StringDecoder('utf8');
  const stream = createReadStream(file, { highWaterMark: 32 * 1024, end: MAX_FILE_BYTES });
  let bytes = 0;

  for await (const chunk of stream) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_FILE_BYTES || (chunk as Buffer).includes(0)) throw new ContextReadError();

    yield* splitSegments(state, decoder.write(chunk as Buffer));
  }

  yield* splitSegments(state, decoder.end());
  yield { line: state.line, column: state.column, text: state.pending, end: true };
}

function* splitSegments(state: ScanState, chunk: string): Generator<TextSegment> {
  state.pending += chunk;

  while (state.pending.length > 0) {
    const newline = state.pending.indexOf('\n');
    const end = newline >= 0 && newline <= MAX_SEGMENT_CHARS;
    if (!end && state.pending.length <= MAX_SEGMENT_CHARS) break;

    let cut = end ? newline : safeCut(state.pending, MAX_SEGMENT_CHARS);
    if (!end && state.pending[cut - 1] === '\r') cut--;

    const text = state.pending.slice(0, cut);
    yield { line: state.line, column: state.column, text: end ? text.replace(/\r$/, '') : text, end };
    state.pending = state.pending.slice(cut + (end ? 1 : 0));
    if (end) {
      state.line++;
      state.column = 1;
    } else {
      state.column += cut;
    }
  }
}

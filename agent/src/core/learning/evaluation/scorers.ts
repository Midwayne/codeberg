import { isDeepStrictEqual } from 'node:util';

import type { EvalScore, OutputScorer } from './types.js';

export function skipped(name: string, reason: string): EvalScore {
  return { name, score: null, metadata: { reason, scorer_version: 1 } };
}

/** Literal equality and JSON syntax are separate diagnostics, not semantic correctness. */
export function outputScorers(): OutputScorer[] {
  return [
    {
      name: 'exact_match',
      score: ({ output, expected }) =>
        expected === undefined
          ? skipped('exact_match', 'No reviewed oracle.expected')
          : {
              name: 'exact_match',
              score: Number(isDeepStrictEqual(output, expected)),
              metadata: { scorer_version: 1 },
            },
    },
    {
      name: 'valid_json',
      score: ({ output, output_format }) => {
        if (output_format !== 'json')
          return skipped('valid_json', 'oracle.output_format is not json');

        try {
          if (typeof output === 'string') JSON.parse(output);
          else JSON.parse(JSON.stringify(output));

          return { name: 'valid_json', score: 1, metadata: { scorer_version: 1 } };
        } catch {
          return { name: 'valid_json', score: 0, metadata: { scorer_version: 1 } };
        }
      },
    },
  ];
}

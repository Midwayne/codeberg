import { describe, expect, it } from 'vitest';
import { knowledgeBody, validatedClaims } from './claims.js';
const observed = [
  {
    repo: '/repos/inventory',
    path: 'src/Flow.ts',
    hash: 'hash',
    excerpt_start_line: 14,
    excerpt: 'function getFlow() {\n  return "new-process";\n}',
  },
];

describe('knowledge claim grounding', () => {
  it('accepts current source quotes, computes lines and renders only validated claims', () => {
    const claims = validatedClaims(
      [
        {
          statement: 'Inventory flow now uses the new process.',
          evidence: [
            {
              repo: 'inventory',
              path: 'src/Flow.ts',
              quote: 'return "new-process"',
              symbol: 'getFlow',
            },
          ],
        },
      ],
      observed,
    );

    expect(claims).toMatchObject([
      { evidence: [{ path: 'src/Flow.ts', start_line: 15, end_line: 15 }] },
    ]);
    expect(knowledgeBody(claims!)).toContain('inventory:src/Flow.ts#getFlow:15');
  });

  it('keeps supported claims while dropping unsupported claims and invented line numbers', () => {
    const supported = {
      statement: 'The flow returns the new process.',
      evidence: [{ repo: 'inventory', path: 'src/Flow.ts', quote: 'return "new-process"' }],
    };

    const rejected: number[] = [];
    expect(
      validatedClaims(
        [
          supported,
          {
            statement: 'Also publishes Kafka messages.',
            evidence: [{ repo: 'inventory', path: 'src/Flow.ts', quote: 'sendToKafka()' }],
          },
        ],
        observed,
        (index) => rejected.push(index),
      ),
    ).toMatchObject([supported]);
    expect(rejected).toEqual([1]);
    expect(
      validatedClaims(
        [{ ...supported, evidence: [{ ...supported.evidence[0], start_line: 900 }] }],
        observed,
      ),
    ).toBeUndefined();
  });
});

import type { Procedure } from './response.js';

/** Markdown the agent reads back through search_knowledge; inputs are the recorded ones. */
export function procedureBody(procedure: Procedure): string {
  const steps = procedure.steps.map((step, index) => {
    const lines = [`${index + 1}. ${step.instruction}`];

    if (step.call) {
      lines.push(`   Tool: \`${step.call.name}\``);
      lines.push('   Input used when taught:');
      lines.push(fenced(step.call.input));
    }

    if (step.evidence) lines.push(`   User said: “${step.evidence}”`);

    return lines.join('\n');
  });

  const quoted = (items: Procedure['rules']) =>
    items.map((item) => `- ${item.statement} (user said: “${item.evidence}”)`).join('\n');

  return [
    '## When to use',
    procedure.when_to_use,
    ...(procedure.inputs.length
      ? ['## Inputs needed', procedure.inputs.map((input) => `- ${input}`).join('\n')]
      : []),
    '## Steps',
    'Taught by the user and confirmed with a rating. Adapt the inputs to the current request, and check results as you go.',
    steps.join('\n'),
    ...(procedure.done_when ? ['## Done when', procedure.done_when] : []),
    ...(procedure.rules.length ? ['## Rules from the user', quoted(procedure.rules)] : []),
    ...(procedure.never.length ? ['## Never', quoted(procedure.never)] : []),
  ].join('\n\n');
}

function fenced(input: unknown): string {
  const text = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const body = (text ?? '').slice(0, 4_000);

  return ['   ```', ...body.split('\n').map((line) => `   ${line}`), '   ```'].join('\n');
}

/** The "When to use" line of a saved procedure, shown in the chat index as its trigger. */
export function procedureTrigger(body: string): string | undefined {
  return /## When to use\n\n([^\n]+)/.exec(body)?.[1]?.trim().slice(0, 160);
}

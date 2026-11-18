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

  const rules = procedure.rules.map(
    (rule) => `- ${rule.statement} (user said: “${rule.evidence}”)`,
  );

  return [
    '## When to use',
    procedure.when_to_use,
    '## Steps',
    'Taught by the user and confirmed with a rating. Adapt the inputs to the current request, and check results as you go.',
    steps.join('\n'),
    ...(rules.length ? ['## Rules from the user', rules.join('\n')] : []),
  ].join('\n\n');
}

function fenced(input: unknown): string {
  const text = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const body = (text ?? '').slice(0, 4_000);

  return ['   ```', ...body.split('\n').map((line) => `   ${line}`), '   ```'].join('\n');
}

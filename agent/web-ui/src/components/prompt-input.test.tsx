import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PromptInput } from './prompt-input';

describe('PromptInput attachments', () => {
  it('only offers media types declared by the selected chat model', () => {
    const render = (inputs: ('text' | 'vision' | 'audio' | 'video' | 'pdf')[]) =>
      renderToStaticMarkup(<PromptInput inputs={inputs} busy={false} onSend={() => undefined} onStop={() => undefined} />);
    expect(render(['text'])).not.toContain('aria-label="Attach files"');
    const html = render(['text', 'vision', 'pdf']);
    expect(html).toContain('accept="image/*,application/pdf"');
    expect(html).toContain('aria-label="Attach files"');
    expect(html).not.toContain('audio/*');
    expect(html).not.toContain('video/*');
  });
});

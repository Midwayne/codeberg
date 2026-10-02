import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { clipboardImages, PromptInput } from './prompt-input';

describe('PromptInput attachments', () => {
  it('labels the composer and preserves a suggested question as an editable draft', () => {
    const html = renderToStaticMarkup(<PromptInput value="Where is the main entry point?" onValueChange={() => undefined} inputs={['text']} busy={false} onSend={() => undefined} onStop={() => undefined} />);
    expect(html).toContain('aria-label="Message"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('Where is the main entry point?');
  });

  it('only offers media types declared by the selected chat model', () => {
    const render = (inputs: ('text' | 'vision' | 'audio' | 'video' | 'pdf')[]) =>
      renderToStaticMarkup(<PromptInput value="" onValueChange={() => undefined} inputs={inputs} busy={false} onSend={() => undefined} onStop={() => undefined} />);
    expect(render(['text'])).not.toContain('aria-label="Attach files"');
    const html = render(['text', 'vision', 'pdf']);
    expect(html).toContain('accept="image/*,application/pdf"');
    expect(html).toContain('aria-label="Attach files"');
    expect(html).not.toContain('audio/*');
    expect(html).not.toContain('video/*');
  });

  it('accepts pasted screenshots only when vision is selected, leaving other pastes alone', () => {
    const image = { type: 'image/png', name: 'Screenshot.png', size: 1200 } as File;
    const text = { type: 'text/plain', name: 'notes.txt' } as File;
    const pdf = { type: 'application/pdf', name: 'report.pdf' } as File;
    const clipboard = [text, image, pdf] as unknown as FileList;
    expect(clipboardImages(clipboard, ['text'])).toEqual([]);
    expect(clipboardImages(clipboard, ['text', 'pdf'])).toEqual([]);
    expect(clipboardImages(clipboard, ['text', 'vision'])).toEqual([image]);
    expect(clipboardImages([] as unknown as FileList, ['text', 'vision'])).toEqual([]);
  });
});

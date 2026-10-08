import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { clipboardImages, PromptInput } from './prompt-input';
import { createPromptSubmit } from './use-prompt-input';
import { PromptFiles } from './prompt-files';
import type { PromptInputViewProps } from './prompt-input';

describe('PromptInput attachments', () => {
  it('groups attachments behind a compact file count with named removal controls', () => {
    const state = { files: [
      { name: 'source.png', type: 'image/png' },
      { name: 'spec.pdf', type: 'application/pdf' },
      { name: 'diagram.png', type: 'image/png' },
    ], setFiles: vi.fn() } as unknown as PromptInputViewProps;
    const html = renderToStaticMarkup(<PromptFiles state={state} />);

    expect(html).toContain('<details');
    expect(html).toContain('3 files');
    expect(html).toContain('aria-label="Remove spec.pdf"');
    expect(html).toContain('diagram.png');
  });

  it('keeps an active composer available for queued follow-ups and steering, with a separate Stop action', () => {
    const html = renderToStaticMarkup(
      <PromptInput value="Focus on the watcher" onValueChange={() => undefined} inputs={['text', 'vision']}
        busy={true} onSend={() => undefined} onSteer={() => undefined} onStop={() => undefined} />,
    );

    expect(html).toContain('aria-label="Queue follow-up"');
    expect(html).toContain('aria-label="Steer now"');
    expect(html).toContain('aria-label="Stop response"');
    expect(html).toContain('Enter to queue');
    expect(html).toContain('Add a follow-up or steer the response');
    expect(html).not.toContain('disabled=""');
  });

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

  it('submits queued and steering drafts with their attachments and clears only the accepted draft', () => {
    vi.stubGlobal('DataTransfer', class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    });
    const file = { name: 'diagram.png', type: 'image/png' } as File;
    const send = vi.fn();
    const steer = vi.fn();
    const clear = vi.fn();
    const state = { value: '  Follow up  ', files: [file], disabled: false, onSend: send, onSteer: steer,
      setValue: clear, setFiles: vi.fn(), setFileError: vi.fn(), fileRef: { current: null }, setDismissed: vi.fn() };

    try {
      const actions = createPromptSubmit(state);
      actions.submit();
      actions.steer?.();

      expect(send).toHaveBeenCalledWith('Follow up', [file]);
      expect(steer).toHaveBeenCalledWith('Follow up', [file]);
      expect(clear).toHaveBeenCalledWith('');

      createPromptSubmit({ ...state, disabled: true }).submit();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

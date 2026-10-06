import { useEffect, useState, type RefObject } from 'react';

import { type CatalogModel } from '../../lib/models';

import { usePromptCommands, usePromptKeyboard } from './use-prompt-commands';
import { inputFor } from '../../lib/prompt-files';

export type PromptInputOptions = {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  disabled?: boolean;
  inputs: CatalogModel['inputs'];
  onSend: (text: string, files: FileList) => void;
  onStop: () => void;
};

export function usePromptInput({
  value,
  onValueChange: setValue,
  inputRef,
  busy,
  disabled = false,
  inputs,
  onSend,
  onStop,
}: PromptInputOptions) {
  const files = usePromptFiles({ inputs });
  const commands = usePromptCommands({ inputRef, value });
  const { submit } = createPromptSubmit({
    ...files,
    value,
    busy,
    disabled,
    onSend,
    setValue,
    fileRef: commands.fileRef,
    setDismissed: commands.setDismissed,
  });
  const keyboard = usePromptKeyboard({ ...commands, setValue, submit });

  return { ...files, ...commands, ...keyboard, value, setValue, inputs, busy, disabled, onStop, submit };
}

export type PromptFilesOptions = Pick<Parameters<typeof usePromptInput>[0], 'inputs'>;

export function usePromptFiles({ inputs }: PromptFilesOptions) {
  const [files, setFiles] = useState<File[]>([]);

  const [fileError, setFileError] = useState('');

  useEffect(() => {
    setFiles((current) => {
      const supported = current.filter((file) => {
        const input = inputFor(file);
        return input && inputs.includes(input);
      });
      return supported.length === current.length ? current : supported;
    });
  }, [inputs]);

  const acceptedTypes = [
    inputs.includes('vision') && 'image/*',
    inputs.includes('audio') && 'audio/*',
    inputs.includes('video') && 'video/*',
    inputs.includes('pdf') && 'application/pdf',
  ]
    .filter(Boolean)
    .join(',');

  return { files, setFiles, setFileError, fileError, acceptedTypes };
}

export type PromptSubmitOptions = Pick<
  Parameters<typeof usePromptInput>[0],
  'value' | 'busy' | 'disabled' | 'onSend'
> & {
  files: File[];
  setValue: Parameters<typeof usePromptInput>[0]['onValueChange'];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setFileError: React.Dispatch<React.SetStateAction<string>>;
  fileRef: RefObject<HTMLInputElement | null>;
  setDismissed: React.Dispatch<React.SetStateAction<boolean>>;
};

export function createPromptSubmit({
  value,
  files,
  busy,
  disabled,
  onSend,
  setValue,
  setFiles,
  setFileError,
  fileRef,
  setDismissed,
}: PromptSubmitOptions) {
  function submit() {
    const text = value.trim();
    if ((!text && !files.length) || busy || disabled) return;
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    onSend(text, transfer.files);
    setValue('');
    setFiles([]);
    setFileError('');
    if (fileRef.current) fileRef.current.value = '';
    setDismissed(false);
  }

  return { submit };
}

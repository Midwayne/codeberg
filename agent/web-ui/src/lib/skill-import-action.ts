import { type useSkillImport } from './use-skill-import';

import { type SkillFile } from './skill-files';

export type SkillImportActionOptions = Pick<
  Parameters<typeof useSkillImport>[0],
  'onBusyChange' | 'api' | 'scope' | 'scopeLabel' | 'onImported'
> & {
  action: React.RefObject<AbortController | null>;
  setBusy: React.Dispatch<React.SetStateAction<'preview' | 'import' | null>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSaved: React.Dispatch<React.SetStateAction<string>>;
  files: SkillFile[];
  setFiles: React.Dispatch<React.SetStateAction<SkillFile[]>>;
};

export function createSkillImportAction(state: SkillImportActionOptions) {
  async function importFiles() {
    if (state.action.current) return;
    const controller = new AbortController();
    state.action.current = controller;
    state.setBusy('import');
    state.onBusyChange(true);
    state.setError('');
    state.setSaved('');
    const remaining: SkillFile[] = [];
    let imported = 0;
    try {
      for (const file of state.files) {
        if (controller.signal.aborted) return;
        if (file.error || !file.name || file.content === undefined) {
          remaining.push(file);
          continue;
        }
        try {
          await importSkillFile(state.api, state.scope, file, controller.signal);
          imported++;
        } catch (reason) {
          if (controller.signal.aborted) return;
          remaining.push({ ...file, importError: reason instanceof Error ? reason.message : String(reason) });
        }
      }
      if (!controller.signal.aborted) {
        state.setFiles(remaining);
        if (imported) {
          state.setSaved(
            `${imported} ${imported === 1 ? 'skill' : 'skills'} imported into ${state.scopeLabel}. Available on the next chat turn.`,
          );
          state.onImported();
        }
      }
    } finally {
      state.action.current = null;
      if (!controller.signal.aborted) {
        state.setBusy(null);
        state.onBusyChange(false);
      }
    }
  }

  return { importFiles };
}

async function importSkillFile(api: typeof fetch, scope: string, file: SkillFile, signal: AbortSignal): Promise<void> {
  const response = await api('/api/extensions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'skill', scope, name: file.name, content: file.content }),
    signal,
  });

  if (!response.ok) throw new Error(await response.text());
}

import { SkillDropZone } from './skill-drop-zone';
import { SkillPreviewList } from './skill-preview';
import { useSkillImport } from '../lib/use-skill-import';
import { SuccessNotice } from './success-notice';

import { type SkillFile } from '../lib/skill-files';

export { buttonClass as button } from './button-styles';

export type SkillImportProps = {
  api: typeof fetch;
  scope: string;
  scopeLabel: string;
  onImported: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function SkillImport(props: SkillImportProps) {
  const state = useSkillImport(props);

  return <SkillImportView {...state} />;
}

export type SkillImportViewProps = ReturnType<typeof useSkillImport>;

export function SkillImportView(state: SkillImportViewProps) {
  return (
    <section aria-label="Import skill files" className="space-y-3">
      <h3 className="text-sm font-medium">Import skill files</h3>
      <SkillDropZone
        busy={state.busy}
        depth={state.depth}
        setDragging={state.setDragging}
        preview={state.preview}
        dragging={state.dragging}
        input={state.input}
      />
      <SkillPreviewList
        files={state.files}
        scopeLabel={state.scopeLabel}
        busy={state.busy}
        setFiles={state.setFiles}
        ready={state.ready}
        importFiles={state.importFiles}
      />
      {state.busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.busy === 'preview'
            ? 'Preparing a preview. Files have not been imported.'
            : 'Importing selected skills…'}
        </p>
      )}
      {state.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {state.error}
        </p>
      )}
      <SuccessNotice
        message={state.saved}
        sizingText={`20 skills imported into ${state.scopeLabel}. Available on the next chat turn.`}
      />
    </section>
  );
}

export type SkillPreviewRowProps = Pick<Parameters<typeof SkillPreviewList>[0], 'busy' | 'setFiles'> & {
  index: number;
  file: SkillFile;
};

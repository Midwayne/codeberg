import type { useModelSettingsPanel } from '../lib/use-model-settings';
import { ErrorNotice } from './ui';

type PanelState = ReturnType<typeof useModelSettingsPanel>;

type ModelSettingsActionsProps = Pick<PanelState, 'onClose' | 'draft' | 'saving'>;

export function ModelSettingsActions({ onClose, draft, saving }: ModelSettingsActionsProps) {
  return (
    <div className="mt-5 flex shrink-0 justify-end gap-2 border-t border-border pt-4">
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent md:min-h-9"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={!draft || saving}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 md:min-h-9"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

type ModelSettingsErrorProps = Pick<PanelState, 'error' | 'draft' | 'save' | 'setAttempt'>;

export function ModelSettingsError({ error, draft, save, setAttempt }: ModelSettingsErrorProps) {
  return (
    error && (
      <div className="mt-3">
        <ErrorNotice
          title={draft ? 'Could not save model settings' : 'Could not load models'}
          detail={error}
          onRetry={() => {
            if (draft) void save();
            else setAttempt((value) => value + 1);
          }}
        />
      </div>
    )
  );
}

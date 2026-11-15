import { useProjectApi } from './project-api';

import { useEffect, useState } from 'react';

import { loadModelSettings, type CatalogModel } from './models';
import { loadLearningSettings } from './learning-settings';
import { startLearningStatusPolling } from './learning-status';

export type WorkspaceMetaOptions = { loading: boolean };

export function useWorkspaceMeta({ loading }: WorkspaceMetaOptions) {
  const { fetch: api } = useProjectApi();
  const { title, chatInputs, learningEnabled, learningActive, trainingEnabled, refreshMeta } = useWorkspaceMetaState(api);
  const [learningBusy, setLearningBusy] = useState(false);

  useEffect(() => {
    if (!loading) refreshMeta();
  }, [api, loading]);

  useEffect(() => {
    if (!learningActive) {
      setLearningBusy(false);
      return;
    }

    return startLearningStatusPolling(setLearningBusy, api);
  }, [learningActive, api]);

  return { title, chatInputs, learningEnabled, trainingEnabled, learningBusy, refreshMeta };
}

type Meta = { title?: string; capabilities?: { learning?: boolean } };

/** What the workspace shows about the server: its title, learning switches, and the chat model's inputs. */
function useWorkspaceMetaState(api: typeof fetch) {
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [chatInputs, setChatInputs] = useState<CatalogModel['inputs']>(['text']);
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [learningActive, setLearningActive] = useState(false);
  const [trainingEnabled, setTrainingEnabled] = useState(false);

  /** Three independent reads; a failure in one leaves the others' values in place. */
  function refreshMeta(): void {
    api('/api/meta')
      .then((response) => (response.ok ? response.json() : null))
      .then((meta: Meta | null) => {
        if (meta?.title) setTitle(meta.title);
        setLearningEnabled(meta?.capabilities?.learning === true);
      })
      .catch((err: unknown) => console.warn('failed to load /api/meta', err));

    void loadLearningSettings(api)
      .then((settings) => {
        setLearningActive(Boolean(settings?.enabled));
        setTrainingEnabled(Boolean(settings?.enabled && settings.datasets && (settings.training || settings.evals)));
      })
      .catch((err: unknown) => console.warn('failed to load learning settings', err));

    loadModelSettings()
      .then((settings) => {
        setChatInputs(settings.models.find((model) => model.key === settings.chat.key)?.inputs ?? ['text']);
      })
      .catch((err: unknown) => console.warn('failed to load /api/models', err));
  }

  return { title, chatInputs, learningEnabled, learningActive, trainingEnabled, refreshMeta };
}

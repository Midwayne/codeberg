import { useProjectApi } from './project-api';

import { useEffect, useState } from 'react';

import { loadModelSettings, type ChatModels } from './models';
import { loadLearningSettings } from './learning-settings';
import { startLearningStatusPolling } from './learning-status';

type WorkspaceMetaOptions = { loading: boolean };

export function useWorkspaceMeta({ loading }: WorkspaceMetaOptions) {
  const { fetch: api } = useProjectApi();
  const { title, chatModels, learningEnabled, learningActive, trainingEnabled, refreshMeta } = useWorkspaceMetaState(api);
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

  return { title, chatModels, learningEnabled, trainingEnabled, learningBusy, refreshMeta };
}

type Meta = { title?: string; capabilities?: { learning?: boolean } };

/** What the workspace shows about the server: its title, learning switches, and the chat models. */
function useWorkspaceMetaState(api: typeof fetch) {
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [chatModels, setChatModels] = useState<ChatModels>();
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
        setChatModels({ models: settings.models, chat: settings.chat });
      })
      .catch((err: unknown) => console.warn('failed to load /api/models', err));
  }

  return { title, chatModels, learningEnabled, learningActive, trainingEnabled, refreshMeta };
}

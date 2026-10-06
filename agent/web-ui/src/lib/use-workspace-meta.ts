import { useProjectApi } from './project-api';

import { useEffect, useState } from 'react';

import { loadModelSettings, type CatalogModel } from './models';
import { loadLearningSettings } from './learning-settings';
import { startLearningStatusPolling } from './learning-status';

import { type useProjectWorkspace } from '../App';

export type WorkspaceMetaOptions = Pick<Parameters<typeof useProjectWorkspace>[0], 'loading'>;

export function useWorkspaceMeta({ loading }: WorkspaceMetaOptions) {
  const { fetch: api } = useProjectApi();

  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');

  const [chatInputs, setChatInputs] = useState<CatalogModel['inputs']>(['text']);

  const [learningEnabled, setLearningEnabled] = useState(false);

  const [learningActive, setLearningActive] = useState(false);

  const [trainingEnabled, setTrainingEnabled] = useState(false);

  const [learningBusy, setLearningBusy] = useState(false);
  const { refreshMeta } = useMetaRefresh({
    api,
    setTitle,
    setLearningEnabled,
    setLearningActive,
    setTrainingEnabled,
    setChatInputs,
  });

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

export type MetaRefreshOptions = {
  api: typeof fetch;
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  setLearningEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setLearningActive: React.Dispatch<React.SetStateAction<boolean>>;
  setTrainingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setChatInputs: React.Dispatch<React.SetStateAction<('text' | 'vision' | 'audio' | 'video' | 'pdf')[]>>;
};

export function useMetaRefresh({
  api,
  setTitle,
  setLearningEnabled,
  setLearningActive,
  setTrainingEnabled,
  setChatInputs,
}: MetaRefreshOptions) {
  function refreshMeta(): void {
    api('/api/meta')
      .then((response) => (response.ok ? response.json() : null))
      .then((meta: { title?: string; capabilities?: { learning?: boolean } } | null) => {
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

  return { refreshMeta };
}

import { useSyncExternalStore } from 'react';

import type { ModelSelection } from '../../lib/models';
import type { ChatModelChoice } from '../../sessions/chat-model';

const noModel = () => () => undefined;

/** This chat's own model and why saving it in the background last failed, if it did. */
export function useChatModel(model?: ChatModelChoice): { ownModel: ModelSelection | null; modelError: string } {
  const subscribe = model?.subscribe ?? noModel;
  const readModel = () => model?.current ?? null;
  const readError = () => model?.error ?? '';

  const ownModel = useSyncExternalStore(subscribe, readModel, readModel);
  const modelError = useSyncExternalStore(subscribe, readError, readError);

  return { ownModel, modelError };
}

import { defaultLearningRoot } from './identity.js';
import { repositoryVersions } from './repositories.js';

export class LearningStoreState {
  readonly root: string;

  writeChain: Promise<void> = Promise.resolve();

  constructor(
    root = defaultLearningRoot(),
    readonly repositoryProvider = repositoryVersions,
  ) {
    this.root = root;
  }
}

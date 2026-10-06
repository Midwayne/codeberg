import { DEFAULT_LEASE_MS } from './policy.js';

export class DurableJobQueueState {
  constructor(
    readonly root: string,
    readonly now: () => Date = () => new Date(),
    readonly leaseMs = DEFAULT_LEASE_MS,
  ) {}
}

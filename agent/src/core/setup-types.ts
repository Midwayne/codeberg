export interface SetupProvider {
  provider: string;
  label: string;
  missing: string[];
}

export type SetupReason = 'no-model' | 'missing-credentials' | 'invalid-config';

/** Whether chat can start, and what the user must configure when it cannot. */
export type SetupStatus =
  | { ready: true }
  | { ready: false; reason: SetupReason; detail: string; providers: SetupProvider[] };

export type SetupRequired = Extract<SetupStatus, { ready: false }>;

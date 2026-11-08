import { useCallback, useEffect, useState } from 'react';

import { loadSetupStatus } from './status';
import { type SetupStatus } from '@agent/core/setup-types.js';

export type SetupState = {
  status: SetupStatus | undefined;
  checking: boolean;
  stillMissing: boolean;
  recheck: () => void;
};

/** Load the setup status once; a successful recheck opens the app. */
export function useSetupStatus(): SetupState {
  const [status, setStatus] = useState<SetupStatus>();
  const [checking, setChecking] = useState(false);
  const [stillMissing, setStillMissing] = useState(false);

  useEffect(() => {
    let active = true;

    void loadSetupStatus().then((next) => {
      if (active) setStatus(next);
    });

    return () => {
      active = false;
    };
  }, []);

  const recheck = useCallback(() => {
    setChecking(true);

    void loadSetupStatus().then((next) => {
      if (next.ready) {
        window.location.assign('/');

        return;
      }

      setStatus(next);
      setStillMissing(true);
      setChecking(false);
    });
  }, []);

  return { status, checking, stillMissing, recheck };
}

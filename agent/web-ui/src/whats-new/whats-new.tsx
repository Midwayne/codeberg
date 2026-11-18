import { lazy, Suspense, useEffect, useState } from 'react';

import { MotionPresence } from '../components/motion-presence';
import { parseVersion } from './releases';
import { decideWhatsNew, readSeenVersion, recordSeenVersion } from './seen';
import { APP_VERSION } from './version';

// The notes and their markdown renderer load only when there is something new.
const WhatsNewDialog = lazy(() => import('./dialog').then((module) => ({ default: module.WhatsNewDialog })));

/** Opens the release notes once after Codeberg is updated. */
export function WhatsNew({ enabled, version = APP_VERSION }: { enabled: boolean; version?: string }) {
  const [decision] = useState(() => decideWhatsNew(readSeenVersion(), version));
  const [open, setOpen] = useState(decision.show);

  if (!decision.show) return null;

  const close = () => {
    recordSeenVersion(version);
    setOpen(false);
  };

  return (
    <MotionPresence visible={enabled && open}>
      <Suspense fallback={null}>
        <WhatsNewDialog since={decision.since} version={version} onClose={close} />
      </Suspense>
    </MotionPresence>
  );
}

/** First-run screens record the installed version so new users are not shown old notes. */
export function useRecordFirstRun(version = APP_VERSION) {
  useEffect(() => {
    if (readSeenVersion() === null && parseVersion(version)) recordSeenVersion(version);
  }, [version]);
}

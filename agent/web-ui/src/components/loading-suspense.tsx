import { Suspense, useLayoutEffect, useState, type ReactNode } from 'react';

import { LoadingBoundary, type LoadingBoundaryProps } from './loading';

export function LoadingSuspense({ children, ...props }: Omit<LoadingBoundaryProps, 'loading' | 'contentReady'>) {
  const [ready, setReady] = useState(false);

  return (
    // Suspense already hides unfinished children. Resolved screens can focus
    // their heading immediately, even before the loading layer has faded away.
    <LoadingBoundary {...props} loading={!ready} contentReady>
      <Suspense fallback={null}>
        <Ready onReady={setReady}>{children}</Ready>
      </Suspense>
    </LoadingBoundary>
  );
}

function Ready({ onReady, children }: { onReady: (ready: boolean) => void; children: ReactNode }) {
  useLayoutEffect(() => {
    onReady(true);
  }, [onReady]);

  return <div className="ui-lazy-content">{children}</div>;
}

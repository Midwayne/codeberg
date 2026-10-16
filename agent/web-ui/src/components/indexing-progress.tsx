import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { IconButton } from './ui';
import { button } from './project-styles';
import { IndexingMeter, indexingPhase } from './indexing-meter';
import type { Project, ProjectStatus } from '../lib/project-api';
import './indexing-progress.css';

type Status = { id: string; value?: ProjectStatus; error?: string };

export type ProjectNoticeProps = {
  currentStatus: Status | undefined;
  project: Project;
  api: typeof fetch;
  setRetry: React.Dispatch<React.SetStateAction<number>>;
  setStatus: React.Dispatch<React.SetStateAction<Status | undefined>>;
};

export function ProjectNotice(props: ProjectNoticeProps) {
  const [minimized, setMinimized] = useState(false);
  const { currentStatus, project } = props;
  const error = currentStatus?.error;
  const title = error ? 'Project index unavailable' : indexingPhase(currentStatus?.value?.progress);

  return (
    <aside aria-label={`Indexing ${project.name}`}
      className={`fixed bottom-36 left-3 z-30 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover text-popover-foreground md:bottom-4 ${minimized ? 'w-48' : 'w-72'}`}>
      <div className="flex items-center gap-2 pl-3">
        <p role="status" className="min-w-0 flex-1 truncate text-xs font-medium">{title}</p>
        <IconButton aria-label={minimized ? 'Expand indexing progress' : 'Minimize indexing progress'}
          aria-expanded={!minimized} onClick={() => setMinimized(!minimized)}>
          {minimized ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </IconButton>
      </div>
      {!error && <IndexingMeter progress={currentStatus?.value?.progress} />}
      {!minimized && <ProgressDetails {...props} />}
    </aside>
  );
}

function ProgressDetails({ currentStatus, project, api, setRetry, setStatus }: ProjectNoticeProps) {
  async function retry() {
    try {
      const response = await api('/api/project/retry', { method: 'POST' });
      if (!response.ok) throw new Error('Retry failed');

      setRetry((value) => value + 1);
    } catch (reason) {
      setStatus({ id: project.id, error: String(reason) });
    }
  }

  return (
    <div className="space-y-2 break-words px-3 pb-3 pt-2 text-xs leading-5 text-muted-foreground">
      <p className="truncate" title={project.name}>{project.name}</p>
      {project.roots.length > 1 && currentStatus?.value?.progress && <p>Repository: {currentStatus.value.progress.repo}</p>}
      {currentStatus?.error && <p>{currentStatus.error}</p>}
      <p>Chat and file tools remain available.</p>
      {currentStatus?.error && <button type="button" className={button} onClick={() => void retry()}>Retry</button>}
    </div>
  );
}

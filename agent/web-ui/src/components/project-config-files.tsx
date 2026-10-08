import { ChevronDown } from 'lucide-react';
import type { ProjectDetailsProps } from './project-details';

export type ProjectConfigFilesProps = { state: ProjectDetailsProps };

export function ProjectConfigFiles({ state }: ProjectConfigFilesProps) {
  return (
    state.project.configDirectory && (
      <details className="group min-w-0 sm:ml-35">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"
          />
          Config files
        </summary>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 pb-1 text-xs leading-5">
          <dt>
            <code>mcp.json</code>
          </dt>
          <dd className="text-muted-foreground">MCP servers</dd>
          <dt>
            <code>skills/</code>
          </dt>
          <dd className="text-muted-foreground">Project skills</dd>
          <dt>
            <code>spec.yml</code>
          </dt>
          <dd className="text-muted-foreground">Database connections</dd>
        </dl>
      </details>
    )
  );
}

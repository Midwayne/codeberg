import { CanvasArtifact } from '../../canvas/artifact';
import { isCanvasDrawing } from '../../canvas/conversation';
import { SpilledOutput, ToolPending, ToolError, GenericTool } from './tool-status';
import { FileContent, FileList, ReposList, TextOutput } from './tool-file-results';
import { type DisplayHit } from './tool-source-cards';
import {
  SearchResults,
  HybridSearchResults,
  ChunkHits,
  ChunkDetail,
  GrepResults,
  FindReferencesResults,
  TracePathResults,
} from './tool-search-results';
import type { ReactNode } from 'react';

import { type ToolView } from './message';

import { isSpillPreview } from '../../lib/tool-output';

/** Dispatch to a rich renderer when we know the tool shape; otherwise JSON. */
export type ToolViewRouterProps = { part: ToolView };

export function ToolViewRouter({ part }: ToolViewRouterProps) {
  const name =
    part.type === 'dynamic-tool'
      ? (part.toolName ?? 'tool')
      : part.type.startsWith('tool-')
        ? part.type.slice('tool-'.length)
        : 'tool';

  if (part.state !== 'output-available' && part.state !== 'output-error') {
    return <ToolPending name={name} part={part} />;
  }

  if (part.state === 'output-error') {
    return <ToolError name={name} message={part.errorText ?? 'tool failed'} />;
  }

  if (isSpillPreview(part.output)) {
    return <SpilledOutput name={name} output={part.output} />;
  }

  if (isCanvasDrawing(part)) return <CanvasArtifact part={part} />;

  return <CompletedTool name={name} part={part} />;
}

export type SpilledOutputProps = { name: string; output: string };

export type ToolPendingProps = { name: string; part: ToolView };

export type ToolErrorProps = { name: string; message: string };

export type SearchResultsProps = { part: ToolView };

export type HybridSearchResultsProps = { part: ToolView };

export type ChunkHitsProps = { title: string; part: ToolView };

export type ChunkDetailProps = { part: ToolView };

export type GrepResultsProps = { title: string; part: ToolView };

export type FindReferencesResultsProps = { part: ToolView };

export type TracePathResultsProps = { part: ToolView };

export type FileContentProps = { part: ToolView };

export type FileListProps = { title: string; part: ToolView };

export type ReposListProps = { part: ToolView };

export type TextOutputProps = { title: string; part: ToolView };

export type GenericToolProps = { part: ToolView; name: string };

export type HitListProps = { icon: ReactNode; title: string; hits: DisplayHit[] };

export type SourceCardProps = { hit: DisplayHit };

export type JsonBlockProps = { label: string; value: unknown };

export type CompletedToolProps = { name: string; part: ToolView };

function CompletedTool({ name, part }: CompletedToolProps) {
  switch (name) {
    case 'search_code':
      return <SearchResults part={part} />;
    case 'hybrid_search':
      return <HybridSearchResults part={part} />;
    case 'find_symbol':
    case 'file_outline':
      return <ChunkHits title={name === 'find_symbol' ? 'Symbols' : 'Outline'} part={part} />;
    case 'get_chunk':
      return <ChunkDetail part={part} />;
    case 'grep':
      return <GrepResults title="Grep" part={part} />;
    case 'find_references':
      return <FindReferencesResults part={part} />;
    case 'search_graph':
      return <ChunkHits title="Graph nodes" part={part} />;
    case 'trace_path':
      return <TracePathResults part={part} />;
    case 'read_file':
    case 'head':
    case 'tail':
      return <FileContent part={part} />;
    case 'glob':
    case 'list_dir':
    case 'tree':
      return <FileList title={name} part={part} />;
    case 'repos':
      return <ReposList part={part} />;
    case 'pipe':
    case 'wc':
    case 'sed':
    case 'git_log':
    case 'git_blame':
      return <TextOutput title={name} part={part} />;
    default:
      return <GenericTool part={part} name={name} />;
  }
}

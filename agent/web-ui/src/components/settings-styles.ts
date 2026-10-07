import { Activity, BarChart3, BookOpen, Brain, FolderOpen, Palette, PencilRuler, Puzzle, Trash2 } from 'lucide-react';

import { type CleanupCategory } from '../lib/resources';

export const sections = [
  { id: 'appearance', label: 'Appearance', shortLabel: 'Appearance', icon: Palette },
  { id: 'projects', label: 'Projects', shortLabel: 'Projects', icon: FolderOpen },
  { id: 'mcps', label: 'MCP servers', shortLabel: 'MCPs', icon: Puzzle },
  { id: 'skills', label: 'Skills', shortLabel: 'Skills', icon: BookOpen },
  { id: 'canvas', label: 'Canvas', shortLabel: 'Canvas', icon: PencilRuler },
  { id: 'learning', label: 'Learning', shortLabel: 'Learning', icon: Brain },
  { id: 'usage', label: 'Usage', shortLabel: 'Usage', icon: BarChart3 },
  { id: 'resources', label: 'Resource usage', shortLabel: 'Resources', icon: Activity },
  { id: 'cleanup', label: 'Free up resources', shortLabel: 'Cleanup', icon: Trash2 },
] as const;

export const labels: Record<CleanupCategory, string> = {
  chats: 'Saved chats',
  training: 'Training data',
  knowledge: 'Knowledge documents',
};

export const descriptions: Record<CleanupCategory, string> = {
  chats: 'Saved conversations, including archived chats. Pinned chats are kept.',
  training:
    'Candidates and their training, evaluation, and dismissed copies. Recently reviewed examples are kept together.',
  knowledge:
    'Generated service, flow, concept, and debugging documents, plus consolidation reports and revisions. Original repository files are kept.',
};

export { buttonClass } from './button-styles';

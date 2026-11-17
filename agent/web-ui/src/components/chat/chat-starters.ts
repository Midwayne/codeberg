import { Compass, GitCommitHorizontal, Map as MapIcon, Route, Search, ShieldAlert, Wrench, Zap, type LucideIcon } from 'lucide-react';

export type ChatStarter = { title: string; prompt: string; icon: LucideIcon };

/* Each prompt is a complete, agent-ready request that users can send as is or edit. */
export const chatStarters: ChatStarter[] = [
  {
    title: 'Tour the codebase',
    prompt: 'Give me a tour of this codebase: the main modules, how they connect, and which files to read first.',
    icon: MapIcon,
  },
  {
    title: 'Trace a request',
    prompt: 'Trace what happens end to end when a request reaches the main entry point. Cite each file and symbol.',
    icon: Route,
  },
  {
    title: 'Find where it lives',
    prompt: 'Where is configuration loaded, validated, and passed to the rest of the system?',
    icon: Search,
  },
  {
    title: 'Review recent changes',
    prompt: 'Summarize what changed recently, which areas are most active, and anything that looks risky.',
    icon: GitCommitHorizontal,
  },
  {
    title: 'Start contributing',
    prompt: 'How do I build, test, and run this project locally? List the commands and where they are defined.',
    icon: Compass,
  },
  {
    title: 'Spot fragile code',
    prompt: 'Which parts of this code look fragile or under-tested? Point to specific functions and explain why.',
    icon: ShieldAlert,
  },
  {
    title: 'Explain error handling',
    prompt: 'How are errors created, propagated, and reported to users? Show the main patterns with examples.',
    icon: Wrench,
  },
  {
    title: 'Find hot paths',
    prompt: 'Which code paths are performance-critical, and what do they do to stay fast?',
    icon: Zap,
  },
];

export const STARTERS_PER_PAGE = 4;

export function starterPage(page: number): ChatStarter[] {
  const pages = Math.ceil(chatStarters.length / STARTERS_PER_PAGE);
  const start = (page % pages) * STARTERS_PER_PAGE;

  return chatStarters.slice(start, start + STARTERS_PER_PAGE);
}

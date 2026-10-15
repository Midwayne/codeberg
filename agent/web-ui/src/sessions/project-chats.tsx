import { createContext, useContext, useRef, type ReactNode } from 'react';

import { useProjectApi } from '../lib/project-api';
import { ProjectChatRegistry, ProjectChats } from './project-chat-registry';

export const ProjectChatsContext = createContext<ProjectChatRegistry | undefined>(undefined);

export function ProjectChatsProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new ProjectChatRegistry());

  return <ProjectChatsContext.Provider value={registry.current}>{children}</ProjectChatsContext.Provider>;
}

export function useProjectChats() {
  const registry = useContext(ProjectChatsContext);
  const { project } = useProjectApi();
  const fallback = useRef(new ProjectChats());

  return project && registry ? registry.forProject(project.id) : fallback.current;
}

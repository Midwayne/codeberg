import type { WorkspaceChat } from './workspace-chat';

/** A project owns its live chats independently of any mounted workspace view. */
export class ProjectChats {
  readonly chats = new Map<string, WorkspaceChat>();
  active?: WorkspaceChat;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  persisted = () => {
    this.listeners.forEach((listener) => listener());
  };

  dispose() {
    this.chats.forEach((chat) => chat.dispose());
    this.chats.clear();
    this.active = undefined;
    this.listeners.clear();
  }
}

/** Retained above the project-keyed React tree, including while another project is open. */
export class ProjectChatRegistry {
  private projects = new Map<string, ProjectChats>();

  forProject(id: string): ProjectChats {
    let project = this.projects.get(id);
    if (!project) {
      project = new ProjectChats();
      this.projects.set(id, project);
    }

    return project;
  }

  retain(ids: string[]) {
    for (const [id, project] of this.projects) {
      if (ids.includes(id)) continue;

      project.dispose();
      this.projects.delete(id);
    }
  }
}

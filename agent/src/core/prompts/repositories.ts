import type { DaemonClient } from '../client.js';
import { isRecord } from '../record.js';

const MAX_REPOSITORIES_LISTED = 50;

interface RepositoryEntry {
  key: string;
  root: string;
}

/**
 * The indexed repositories, listed in the changing system block so the agent
 * knows the `repo` keys without spending a round trip on the repos tool.
 * Undefined when the tool is not offered or the daemon cannot list them; the
 * agent then discovers keys with repos as before.
 */
export async function repositoryContext(
  daemon: Pick<DaemonClient, 'callTool'>,
  toolNames: readonly string[],
): Promise<string | undefined> {
  if (!toolNames.includes('repos')) return undefined;

  const repos = await listRepositories(daemon);
  if (repos.length === 0) return undefined;

  const listed = repos.slice(0, MAX_REPOSITORIES_LISTED);
  const lines = [
    'Repositories:',
    'Pass a key as `repo` to the code tools. This list can be out of date; call repos if a repository seems missing.',
    ...listed.map((repo) => `- ${repo.key}: ${repo.root}`),
  ];

  if (repos.length > listed.length) {
    lines.push(`${repos.length - listed.length} more; call repos for the full list.`);
  }

  return lines.join('\n');
}

async function listRepositories(daemon: Pick<DaemonClient, 'callTool'>): Promise<RepositoryEntry[]> {
  try {
    const result = await daemon.callTool('repos', {});
    if (!Array.isArray(result)) return [];

    return result.filter(isRepository);
  } catch {
    return [];
  }
}

function isRepository(value: unknown): value is RepositoryEntry {
  return isRecord(value) && typeof value.key === 'string' && typeof value.root === 'string';
}

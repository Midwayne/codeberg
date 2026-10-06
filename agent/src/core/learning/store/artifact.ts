import type { KnowledgeArtifact } from '../types.js';

export function parseArtifact(raw: string): KnowledgeArtifact {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/m.exec(raw);
  if (!match) throw new Error('invalid knowledge artifact');

  const metadata = JSON.parse(match[1]) as Omit<KnowledgeArtifact, 'body'>;

  return { ...metadata, body: match[2].trim() };
}

export function serializeArtifact(artifact: KnowledgeArtifact): string {
  const { body, ...metadata } = artifact;

  return `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${body.trim()}\n`;
}

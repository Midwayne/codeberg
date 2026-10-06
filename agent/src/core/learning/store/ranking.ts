import type { AttemptRecord, KnowledgeArtifact, KnowledgeSearchHit } from '../types.js';

export function attemptText(attempt: AttemptRecord): string {
  return [
    attempt.user_query,
    attempt.answer,
    ...attempt.search_queries,
    ...attempt.files_inspected,
    ...attempt.symbols_inspected,
  ].join('\n');
}

/** BM25 ranks topical overlap with rare terms above repeated generic words. */
export function rankKnowledge(query: string, artifacts: KnowledgeArtifact[]): KnowledgeSearchHit[] {
  const terms = [...new Set(searchTerms(query))];
  if (!terms.length || !artifacts.length) return [];

  const documents = artifacts.map((artifact) => {
    const body = searchTerms(artifact.body);
    const title = searchTerms(artifact.title);
    const counts = new Map<string, number>();
    for (const term of body) counts.set(term, (counts.get(term) ?? 0) + 1);

    for (const term of title) counts.set(term, (counts.get(term) ?? 0) + 3);

    return { artifact, counts, length: body.length + title.length * 3 };
  });

  const averageLength =
    documents.reduce((total, document) => total + document.length, 0) / documents.length;
  const frequency = new Map(
    terms.map((term) => [term, documents.filter((document) => document.counts.has(term)).length]),
  );

  return documents.map(({ artifact, counts, length }) => ({
    artifact,
    score: terms.reduce((score, term) => {
      const count = counts.get(term) ?? 0;
      if (!count) return score;

      const idf = Math.log(
        1 + (documents.length - frequency.get(term)! + 0.5) / (frequency.get(term)! + 0.5),
      );

      return score + (idf * count * 2.2) / (count + 1.2 * (0.25 + (0.75 * length) / averageLength));
    }, 0),
  }));
}

export function searchTerms(value: string): string[] {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-z0-9]{2,}/g) ?? []
  );
}

export function lexicalScore(query: string, document: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;

  const haystack = document.toLowerCase();
  let matched = 0;
  let occurrences = 0;
  for (const term of terms) {
    const count = haystack.split(term).length - 1;
    if (count > 0) matched++;

    occurrences += Math.min(count, 5);
  }

  const phrase = haystack.includes(query.trim().toLowerCase()) ? 2 : 0;

  return matched / terms.length + occurrences / Math.max(20, terms.length * 10) + phrase;
}

export function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [])];
}

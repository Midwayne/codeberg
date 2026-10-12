import { docPages, headingId, type DocPage } from './catalog';

export type DocSearchHit = {
  href: string;
  title: string;
  group: string;
  section?: string;
  snippet: string;
};

type SearchSection = { title?: string; body: string };

export function searchDocs(query: string, pages: readonly DocPage[] = docPages): DocSearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = pages.flatMap((page) => searchPage(page, terms));

  return ranked.sort((a, b) => b.score - a.score).map(({ hit }) => hit);
}

function searchPage(page: DocPage, terms: string[]) {
  if (!terms.length) return [{ score: 0, hit: pageHit(page, page.summary) }];

  const overview = `${page.title} ${page.summary}`.toLowerCase();
  const results = terms.every((term) => overview.includes(term))
    ? [{ score: 100 + matchScore(page.title, terms), hit: pageHit(page, page.summary) }]
    : [];

  for (const section of sections(page.content)) {
    if (!section.title && results.length) continue;

    const body = plainText(section.body);
    const sectionText = `${section.title ?? ''} ${body}`.toLowerCase();
    const text = `${page.title} ${sectionText}`.toLowerCase();
    if (!terms.every((term) => text.includes(term))) continue;
    if (!terms.some((term) => sectionText.includes(term))) continue;

    results.push({
      score: matchScore(section.title ?? '', terms) + matchScore(page.title, terms),
      hit: { ...pageHit(page, snippet(body, terms)), section: section.title,
        href: `/docs/${page.id}${section.title ? `#${headingId(section.title)}` : ''}` },
    });
  }

  return results;
}

function pageHit(page: DocPage, snippet: string): DocSearchHit {
  return { href: `/docs/${page.id}`, title: page.title, group: page.group, snippet };
}

function matchScore(title: string, terms: string[]) {
  return terms.filter((term) => title.toLowerCase().includes(term)).length * 20;
}

function sections(markdown: string): SearchSection[] {
  const result: SearchSection[] = [{ body: '' }];
  let fenced = false;

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;

    const heading = !fenced && /^## (.+)$/.exec(line);
    if (heading) result.push({ title: heading[1]!, body: '' });
    else result[result.length - 1]!.body += `${line}\n`;
  }

  return result;
}

function plainText(markdown: string) {
  return markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^```.*$/gm, '').replace(/^[#>|-]+\s*/gm, '')
    .replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
}

function snippet(body: string, terms: string[]) {
  const positions = terms.map((term) => body.toLowerCase().indexOf(term)).filter((index) => index >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 40) : 0;
  const end = Math.min(body.length, start + 170);

  return `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

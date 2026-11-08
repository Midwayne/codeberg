import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const AGENT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const PACKAGES = [
  // esbuild drops agent imports that are only used as types.
  { root: join(AGENT_ROOT, 'src'), keepsInlineTypeImports: false },
  // verbatimModuleSyntax keeps `import { type X }` as a runtime import of the module.
  { root: join(AGENT_ROOT, 'web-ui/src'), keepsInlineTypeImports: true },
];

const ALIASES: Record<string, string> = {
  '@/': join(AGENT_ROOT, 'web-ui/src'),
  '@agent/core/': join(AGENT_ROOT, 'src/core'),
};

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) return productionFiles(path);

    const source = /\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
    const test = /\.test\.tsx?$/.test(name);

    return source && !test ? [path] : [];
  });
}

function resolveSpecifier(from: string, specifier: string): string | undefined {
  const alias = Object.keys(ALIASES).find((prefix) => specifier.startsWith(prefix));
  if (!alias && !specifier.startsWith('.')) return undefined;

  const base = alias
    ? join(ALIASES[alias]!, specifier.slice(alias.length))
    : resolve(dirname(from), specifier);
  const stem = base.replace(/\.(js|jsx|ts|tsx)$/, '');
  const candidates = [`${stem}.ts`, `${stem}.tsx`, join(stem, 'index.ts'), join(stem, 'index.tsx')];

  return candidates.find((candidate) => existsSync(candidate));
}

function isTypeOnly(statement: ts.Statement, keepsInlineTypeImports: boolean): boolean {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return false;

    if (clause.isTypeOnly) return true;

    const bindings = clause.namedBindings;
    const allInlineTypes =
      !clause.name &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly);

    return allInlineTypes && !keepsInlineTypeImports;
  }

  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return true;

    const clause = statement.exportClause;

    return (
      clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly) &&
      !keepsInlineTypeImports
    );
  }

  return false;
}

function runtimeImports(file: string, keepsInlineTypeImports: boolean): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);

  return source.statements.flatMap((statement) => {
    const isModuleStatement =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
    if (!isModuleStatement || !statement.moduleSpecifier) return [];

    if (isTypeOnly(statement, keepsInlineTypeImports)) return [];

    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const target = resolveSpecifier(file, specifier);

    return target ? [target] : [];
  });
}

function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const { root, keepsInlineTypeImports } of PACKAGES) {
    for (const file of productionFiles(root)) {
      graph.set(file, runtimeImports(file, keepsInlineTypeImports));
    }
  }

  return graph;
}

/** Tarjan's algorithm: every strongly connected component larger than one module is a cycle. */
function cycles(graph: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, index.size);
    low.set(node, index.get(node)!);
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }

    if (low.get(node) !== index.get(node)) return;

    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);

    const selfImport = graph.get(node)?.includes(node) ?? false;
    if (component.length > 1 || selfImport) found.push(component);
  };

  for (const node of graph.keys()) if (!index.has(node)) visit(node);

  return found.map((component) => component.map((file) => relative(AGENT_ROOT, file)).sort());
}

describe('module graph', () => {
  it('has no runtime import cycles in the agent or web UI', () => {
    const graph = importGraph();

    expect(graph.size).toBeGreaterThan(100);
    expect(cycles(graph)).toEqual([]);
  });
});

import type { McpServerReport } from '../mcp/catalog.js';
import { DBMCP_SERVER_NAME } from '../mcp/builtin.js';
import { DATABASE_QUERY_EXAMPLES } from './examples.js';

/** Name tokens that mark an MCP server or tool as live database access. */
const DATABASE_WORDS = new Set([
  'bigquery', 'cassandra', 'clickhouse', 'database', 'databases', 'db', 'dynamodb',
  'mariadb', 'mongo', 'mongodb', 'mysql', 'pg', 'postgres', 'postgresql', 'redis',
  'snowflake', 'sql', 'sqlite',
]);

/**
 * True when a connected MCP server looks like live database access: the
 * built-in multi-db server, or a server or tool whose name has a database
 * word in it. Only then do the query-consent rules earn their tokens.
 */
export function offersDatabase(servers: readonly McpServerReport[]): boolean {
  return servers.some((server) => server.state === 'connected' && isDatabaseServer(server));
}

function isDatabaseServer(server: McpServerReport): boolean {
  if (server.name === DBMCP_SERVER_NAME) return true;

  const names = [server.name, ...server.tools.map((tool) => tool.name)];

  return names.some((name) => nameTokens(name).some((token) => DATABASE_WORDS.has(token)));
}

function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export const DATABASE_INSTRUCTIONS = `
Database queries:
Respect the index. Always look for the query in the indexed code before you execute it against a database. Find the statement and its call site with the code-search tools. Execute against the database only after that, unless the user has explicitly defined the path to take.

A path from the code is a statement, table, collection, or key you found in the index, together with the call site that runs it. A path from the user is an explicit connection, statement, object, or sequence of steps in their message. Follow a user path, and still cite matching code when the index has it. A repository name or a similar word in an unrelated file is not a path. A statement you composed is not a path until the user agrees to run it.

When the user asks you to come up with a query, learn that database from the indexed code: the statements, the tables or collections, the filters, and the database indexes migrations or queries already use. Write the query in the language that code uses, and use those database indexes where they fit. Show the user the query. Say in plain language what it would read or change. Ask whether to run it, and execute it only after they say yes.

A connected database server's tool names, arguments, and descriptions are the ones that server advertised. Use those tools for the live step. Do not assume a fixed catalog.

${DATABASE_QUERY_EXAMPLES}`;

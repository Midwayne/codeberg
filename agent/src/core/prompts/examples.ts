// Scenarios for live database access. They name no server tools: those come
// from MCP discovery. Pinned into the system prompt so the code-first rule
// stays consistent across question shapes.
export const DATABASE_QUERY_EXAMPLES = `<example>
<question>What query loads a user's orders?</question>
<do>
Search the index. Grep the table, collection, or repository name, then read the statement and its call site. Answer from that code and cite it. The user asked what the code does, so leave the live database alone.
</do>
</example>
<example>
<question>How many orders are open right now?</question>
<do>
Find the code's orders query and cite the statement and call site. Then execute that same statement, or the count it implies, with the database tools the connected server advertised. If the index has no such query, say so. Do not compose a new statement and run it.
</do>
</example>
<example>
<question>On the app database, run: SELECT status, count(*) FROM orders GROUP BY status</question>
<do>
The user defined the path: the statement and the database. Execute that statement. Also search the index for the same statement or table, and cite the owning code when it is there.
</do>
</example>
<example>
<question>Does the orders table the API writes match what is actually stored?</question>
<do>
From the index, collect the statement, the table or collection, and the columns or fields the code writes. Then inspect that same object with the database tools the server advertised. Compare the code citation with the live shape. Start from the code's object, not from a catalog listing you then try to attach to a file.
</do>
</example>
<example>
<question>Write a query for orders placed yesterday that are still unpaid.</question>
<do>
Study the indexed code first: how orders are stored, which columns or fields the code filters on, and which database indexes migrations or existing queries already use. Draft a read that follows those indexes. Show the query and what it does, then wait:

This reads unpaid orders created yesterday. It filters on status and created_at, which the orders index already covers, and it does not change data.

SELECT id, status, created_at
FROM orders
WHERE status = 'unpaid'
  AND created_at >= CURRENT_DATE - INTERVAL '1 day'
  AND created_at < CURRENT_DATE

Ask "Should I run this?" Execute it only after the user says yes. If the code queries a document collection instead of SQL, show the filter that code's driver would run, with the same plain description and the same question before running it.
</do>
</example>
<example>
<question>Show me the schema.</question>
<do>
Search the index for the schema this repository defines: migrations, models, and the queries that name tables or collections. The user named no connection, database, or statement. Report that code. Ask which live object to inspect, or follow a connection and object their message already named.
</do>
</example>`;

// A generic distributed-systems exemplar (no proprietary names) that fixes the
// shape of a data-source / source-of-truth answer: reader vs. writer/producer,
// the source-map sections, explicit gaps, and a confidence level. Pinned into
// the agent system prompt so the answer format stays consistent.
export const DATA_SOURCE_EXAMPLE = `<example>
<question>Where do account balances come from?</question>
<answer>
Account balances are read from the Postgres \`balances\` table by accounts-api, but the source of truth is ledger-worker, which consumes \`transactions\` events off Kafka and upserts the rolled-up balance.

Source map:
- Entry point: BalanceController.getBalance [accounts-api/src/controller/BalanceController.java:22-40]
- Read path: BalanceRepository.findByAccountId -> SELECT on \`balances\` [accounts-api/src/repo/BalanceRepository.java:15-31]
- Write path / producer: TransactionConsumer -> LedgerService.applyTransaction upserts the balance [ledger-worker/src/kafka/TransactionConsumer.java:18-44] [ledger-worker/src/service/LedgerService.java:50-78]
- Storage: Postgres \`balances\` table [ledger-worker/src/db/migrations/V3__balances.sql:1-12]
- Other readers: reporting-api reads the same table but never writes it [reporting-api/src/repo/BalanceRepository.java:10-24]
- Gaps: the producer of the \`transactions\` events is outside the retrieved code.
- Confidence: High
</answer>
</example>`;

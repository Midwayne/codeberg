#!/usr/bin/env node
import { parseSearchArgs, runSearch, searchUsage } from './search.js';

async function main(): Promise<void> {
  const opts = parseSearchArgs(process.argv);
  if (!opts) {
    console.error(searchUsage('codeberg-search'));
    process.exit(1);
  }
  await runSearch(opts);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

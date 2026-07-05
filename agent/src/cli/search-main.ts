#!/usr/bin/env node
import { parseSearchArgs, runSearch, searchUsage, SearchCliError } from './search.js';

async function main(): Promise<void> {
  try {
    const parsed = parseSearchArgs(process.argv);
    if (parsed === 'help') {
      console.log(searchUsage('codeberg-search'));
      return;
    }
    await runSearch(parsed);
  } catch (err) {
    if (err instanceof SearchCliError) {
      console.error(`error: ${err.message}`);
      console.error(searchUsage('codeberg-search'));
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

import { describe, expect, it } from 'vitest';

import { sameTaskFamily, similar } from './dedup.js';

describe('held-out query families', () => {
  it('catches paraphrases and camelCase identifier rewrites', () => {
    expect(
      similar(
        'Where does inventoryAvailability ultimately come from?',
        'Identify the origin of inventory availability',
      ),
    ).toBe(true);
    expect(
      sameTaskFamily(
        { query: 'Trace inventoryAvailability producer', files: ['src/InventoryCalculator.kt'] },
        {
          query: 'What is source of inventory availability?',
          files: ['src/InventoryCalculator.kt'],
        },
      ),
    ).toBe(true);
  });

  it('does not equate unrelated ownership and consumption tasks on a shared file', () => {
    expect(
      sameTaskFamily(
        { query: 'What consumes shipping topic?', files: ['src/EventHandler.ts'] },
        { query: 'How is order validation implemented?', files: ['src/EventHandler.ts'] },
      ),
    ).toBe(false);
  });
});

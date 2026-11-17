import { expect, it } from 'vitest';
import { styleDefaults } from './style-defaults';

it('persists the scene drawing style without saving untouched built-in defaults', () => {
  const builtIn = { currentItemRoughness: 1, currentItemFontFamily: 5, currentItemRoundness: 'round' as const };

  expect(styleDefaults(builtIn, {})).toEqual({});
  expect(styleDefaults({ ...builtIn, currentItemRoughness: 0 }, {})).toEqual({ currentItemRoughness: 0 });
  expect(styleDefaults(builtIn, { currentItemFontFamily: 6 })).toEqual({ currentItemFontFamily: 5 });
});

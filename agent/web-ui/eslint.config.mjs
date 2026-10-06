import tsParser from '@typescript-eslint/parser';

import { codeRules } from '../eslint-rules.mjs';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/**/*.test.{ts,tsx}'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: codeRules,
  },
];

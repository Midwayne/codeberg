import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'web-ui/**', 'src/**/*.test.ts'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'max-lines': ['error', { max: 199, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': [
        'error',
        {
          max: 50,
          skipBlankLines: false,
          skipComments: false,
          IIFEs: true,
        },
      ],
    },
  },
];

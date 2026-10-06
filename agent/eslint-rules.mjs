// Shared production-code limits and whitespace rules for the agent and web UI.
export const codeRules = {
  'no-trailing-spaces': 'error',
  'no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
  'max-statements-per-line': ['error', { max: 1 }],
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
};

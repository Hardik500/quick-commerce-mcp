// ESLint flat config.
//
// The `lint` script has existed in package.json without eslint ever being
// installed or configured, so it could not have run. This is the minimum that
// makes it work and catches real defects: correctness rules, not formatting.
// Formatting is left alone deliberately - there is no formatter configured in
// this repo, and adding style rules would bury the findings that matter under
// churn on every existing line.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Unused args are legitimate when a callback signature is fixed by an
      // interface or by a positional contract (an oracle taking (page, loc, el,
      // selector) ignores the middle two). Convention is to prefix them `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` is used deliberately in this codebase for untyped MCP tool args
      // and for reaching protected members in tests. Flag the bare case only.
      '@typescript-eslint/no-explicit-any': 'off',
      // Empty catch blocks are load-bearing here: they mark a failure that is
      // deliberately tolerated (a probe that must not throw). A comment in the
      // block is what makes it intentional, so require that.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Tests reach protected members and build partial doubles on purpose.
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);

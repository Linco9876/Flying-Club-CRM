import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'output', '.codex-backups', 'apps/duty-clock'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Keep the stable hook correctness rules enabled explicitly. React Hooks 7 also
      // ships opt-in React Compiler diagnostics which require a separate migration
      // rather than silently turning hundreds of new findings into release blockers.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Supabase rows, webhook payloads and legacy settings are validated at runtime and
      // intentionally use `any` at those integration boundaries. The compiler remains
      // strict; actionable unsafe access is handled while migrating those boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // ESLint 10's new initialization diagnostic treats defensive parse/retry
      // defaults as useless even though they make those branches explicit. Keep
      // correctness enforced by TypeScript and the existing unused-variable rule.
      'no-useless-assignment': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  }
);

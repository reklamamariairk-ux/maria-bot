module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    'no-constant-condition': 'error',
    'no-debugger': 'error',
    'no-dupe-else-if': 'error',
    'no-unreachable': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};

module.exports = {
  env: {
    browser: false,
    es2022: true,
    node: true,
    mocha: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    curly: 'off',
    'no-console': 'warn',
    'no-unused-vars': 'warn',
    'no-dupe-class-members': 'off',
  },
  ignorePatterns: ['node_modules/**', 'dist/**', 'coverage/**'],
};

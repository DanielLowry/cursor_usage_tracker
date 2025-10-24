module.exports = {
  root: true,
  extends: [require.resolve('@cursor-usage/config/library')],
  parserOptions: {
    project: './tsconfig.json',
  },
  ignorePatterns: ['**/*.js'],
  overrides: [
    {
      files: ['apps/worker/src/workers/scraper/core/**/*.{ts,tsx}'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              {
                target: ['./apps/worker/src/workers/scraper/core'],
                from: ['./apps/worker/src/workers/scraper/infra'],
                message: 'scraper core modules cannot import infrastructure adapters',
              },
            ],
          },
        ],
      },
    },
  ],
};

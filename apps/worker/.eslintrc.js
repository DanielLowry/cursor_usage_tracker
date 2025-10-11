/* Relative path: apps/worker/.eslintrc.js */

module.exports = {
  root: true,
  extends: [require.resolve("@cursor-usage/config/library")],
  parserOptions: {
    project: "./tsconfig.json",
  },
  ignorePatterns: ["**/*.js"],
};
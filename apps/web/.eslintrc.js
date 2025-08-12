module.exports = {
  root: true,
  extends: [require.resolve("@cursor-usage/config/nextjs")],
  parserOptions: {
    project: "./tsconfig.json",
  },
  ignorePatterns: ["**/*.js"],
};
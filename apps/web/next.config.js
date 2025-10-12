/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cursor-usage/db", "@cursor-usage/types", "@cursor-usage/cursor-auth"],
}

module.exports = nextConfig

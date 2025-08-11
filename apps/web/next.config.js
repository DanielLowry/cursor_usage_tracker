/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cursor-usage/db", "@cursor-usage/types"],
}

module.exports = nextConfig

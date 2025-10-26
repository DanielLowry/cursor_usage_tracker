const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@cursor-usage/db", "@cursor-usage/types", "@cursor-usage/cursor-auth"],
  output : 'standalone',
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../..'),
  },
}

module.exports = nextConfig

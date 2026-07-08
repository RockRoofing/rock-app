/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
  },
  // Subdomain routing for forms.rockroofing.co.uk is handled in middleware.js
  // (single source of truth) to avoid double-handling with rewrites here.
}
module.exports = nextConfig

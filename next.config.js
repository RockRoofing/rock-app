/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
  }
}
module.exports = nextConfig

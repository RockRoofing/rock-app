/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
  },
  async rewrites() {
    return {
      beforeFiles: [
        // forms.rockroofing.co.uk/* -> /forms/* (operative app on its own subdomain)
        {
          source: '/',
          has: [{ type: 'host', value: 'forms.rockroofing.co.uk' }],
          destination: '/forms',
        },
        {
          source: '/:path*',
          has: [{ type: 'host', value: 'forms.rockroofing.co.uk' }],
          destination: '/forms/:path*',
        },
      ],
    }
  },
}
module.exports = nextConfig

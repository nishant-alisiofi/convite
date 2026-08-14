import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The coordinator UI is server-rendered wherever it can be: it has to work on a laptop
  // over a weak connection (Section 10).
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
}

export default nextConfig

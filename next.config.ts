import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The coordinator UI is server-rendered wherever it can be: it has to work on a laptop
  // over a weak connection (Section 10).
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },

  /**
   * The public page is rendered per request (it must not touch the database at build time)
   * but its answer is the same for everybody and changes only when the matcher sweeps. A
   * dynamic route's own Cache-Control is `no-store`, and middleware cannot override it, so
   * the header is declared here — the one place that wins.
   *
   * Everything else stays uncached by omission: a shared cache holding a coordinator's
   * screen is a leak with a long tail, and middleware sets `private, no-store` on it.
   */
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=60, stale-while-revalidate=300',
          },
        ],
      },
    ]
  },
}

export default nextConfig

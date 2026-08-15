import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The coordinator UI is server-rendered wherever it can be: it has to work on a laptop
  // over a weak connection (Section 10).
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },

  /**
   * The public response page (`/respuesta`) is rendered per request (it must not touch the
   * database at build time) but its answer is the same for everybody and changes only when the
   * matcher sweeps. A dynamic route's own Cache-Control is `no-store`, and middleware cannot
   * override it, so the header is declared here — the one place that wins. (The landing at `/`
   * is static, so Next handles its caching without any help here.)
   *
   * Everything else stays uncached by omission: a shared cache holding a coordinator's
   * screen is a leak with a long tail, and middleware sets `private, no-store` on it.
   */
  async headers() {
    return [
      {
        source: '/respuesta',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=60, stale-while-revalidate=300',
          },
        ],
      },
    ]
  },

  /**
   * The front door used to live at `/acerca`; it is now the site root. Redirect the old path
   * so any link that still points at it lands on the landing instead of being bounced to the
   * sign-in by the auth gate (a non-existent route falls through to the middleware otherwise).
   * Runs ahead of middleware in Next's routing order, so it wins. Temporary, not permanent —
   * pre-launch, nothing should hard-cache this in a browser.
   */
  async redirects() {
    return [{ source: '/acerca', destination: '/', permanent: false }]
  },
}

export default nextConfig

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb", // uploads cap; avatar flows use signed-URL upload, not server actions
    },
  },
  // Server-side packages that must run on Node (not Edge) — Prisma, sharp, razorpay, stripe, resend.
  // Edge runtime applies per-route via export const runtime = 'edge' where appropriate.
  serverExternalPackages: ["@prisma/client", "sharp", "razorpay", "stripe", "resend", "@react-pdf/renderer"],

  // Image optimization is delegated to Supabase Storage's image transformation
  // (signed URLs already serve optimized variants); keep on-device allow-list tight.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
    // Defense-in-depth: never resize to anything larger than 2x of the
    // largest display slot (avatar is 400×400, superchat avatar 96×96).
    deviceSizes: [96, 192, 400, 800],
  },

  async headers() {
    // Headers applied to ALL routes. The per-request CSP nonce + a few
    // dynamic rules are set in middleware.ts; here we set the static
    // baseline plus an allowlist of trusted third-party origins for
    // payment SDKs (loaded as iframes via frame-src) and analytics.
    const isProd = process.env.NODE_ENV === "production";

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // CSP baseline — middleware.ts augments this per request with a
          // nonce for 'self' scripts. Third-party payment SDKs are loaded
          // inside iframes (frame-src), not as scripts in our document.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://js.stripe.com https://www.paypal.com https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
              "font-src 'self' https://fonts.gstatic.com data:",
              "connect-src 'self' https://api.razorpay.com https://api.stripe.com https://*.paypal.com https://*.supabase.co https://*.supabase.in https://*.sentry.io https://*.upstash.io",
              "frame-src https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://www.paypal.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://checkout.razorpay.com https://www.paypal.com",
              "object-src 'none'",
              "manifest-src 'self'",
              ...(isProd ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },
      {
        // API routes must NEVER be cached by intermediaries.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
          { key: "Pragma", value: "no-cache" },
          { key: "Surrogate-Control", value: "no-store" },
        ],
      },
    ];
  },

  // We use Sentry's official @sentry/nextjs wrapper. The init config lives
  // in sentry.{client,server,edge}.config.ts and is loaded by the wrapper.
  // Hide source maps from production builds for non-error stack frames.
  productionBrowserSourceMaps: false,
  outputFileTracingIncludes: {
    "/api/payments/**": ["./node_modules/razorpay/dist/**/*", "./node_modules/stripe/**/*"],
  },
};

export default nextConfig;
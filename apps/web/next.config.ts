import type { NextConfig } from 'next';
import { execSync } from 'child_process';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const gitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@ai-sedlacek/shared', '@ai-sedlacek/ocr'],
  serverExternalPackages: ['sharp', 'tesseract.js'],
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_HASH: gitHash,
  },
  // Bezpečnostní HTTP hlavičky pro všechny cesty.
  // App renderuje markdown přes dangerouslySetInnerHTML a je clickjackovatelná,
  // proto explicitně zakazujeme vkládání do <iframe> a vynucujeme HTTPS.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Pouze frame-ancestors — záměrně NEnastavujeme script-src/style-src,
          // protože Next.js používá inline skripty a Tailwind inline styly;
          // přísné CSP by aplikaci rozbilo.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

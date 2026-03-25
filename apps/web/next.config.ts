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
  transpilePackages: ['@ai-sedlacek/shared'],
  serverExternalPackages: ['sharp', 'tesseract.js'],
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_HASH: gitHash,
  },
};

export default withNextIntl(nextConfig);

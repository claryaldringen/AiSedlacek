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
};

export default withNextIntl(nextConfig);

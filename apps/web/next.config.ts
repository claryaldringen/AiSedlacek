import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ai-sedlacek/shared'],
  serverExternalPackages: ['sharp', 'tesseract.js'],
};

export default nextConfig;

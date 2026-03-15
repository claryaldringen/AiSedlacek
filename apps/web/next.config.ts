import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ai-sedlacek/shared'],
  serverExternalPackages: ['sharp'],
};

export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained Node.js server for Docker/VM deployments.
  output: 'standalone',
};

export default nextConfig;

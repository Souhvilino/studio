// @ts-check
// Attempt to load environment variables from /workspace/.env explicitly
// This is a workaround attempt; Next.js should normally handle this.
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const envPath = path.resolve(process.cwd(), 'workspace', '.env');
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.warn(`[next.config.js] Warning: Explicitly loading .env from ${envPath} failed or file not found. Relying on Next.js built-in .env handling. Error:`, result.error.message);
  } else if (result.parsed) {
    console.log(`[next.config.js] Successfully loaded environment variables from ${envPath}`);
    // Optionally log loaded vars to confirm, but be careful with sensitive data in logs
    // console.log('[next.config.js] Loaded vars:', Object.keys(result.parsed));
  } else {
    console.warn(`[next.config.js] dotenv.config() did not parse any variables from ${envPath}. File might be empty or unreadable.`);
  }
} catch (e) {
  console.warn('[next.config.js] Error trying to load dotenv:', e.message);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig;


// @ts-check
// Attempt to load environment variables from /workspace/.env explicitly
// This is a workaround attempt; Next.js should normally handle this.
let firebaseEnvVars = {};
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const envPath = path.resolve(process.cwd(), 'workspace', '.env');
  const result = dotenv.config({ path: envPath });

  if (result.error) {
    console.warn(`[next.config.js] Warning: Explicitly loading .env from ${envPath} failed or file not found. Relying on Next.js built-in .env handling. Error:`, result.error.message);
  } else if (result.parsed) {
    console.log(`[next.config.js] Successfully loaded environment variables from ${envPath}`);
    console.log('[next.config.js] Keys loaded by dotenv:', Object.keys(result.parsed));

    // Populate firebaseEnvVars for nextConfig.env and also try to set process.env directly
    console.log('[next.config.js] Attempting to directly set process.env variables...');
    for (const key in result.parsed) {
      if (Object.prototype.hasOwnProperty.call(result.parsed, key)) {
        // Set for nextConfig.env
        firebaseEnvVars[key] = result.parsed[key];
        // Also directly set on process.env for the current context
        process.env[key] = result.parsed[key];
        console.log(`[next.config.js] Directly set process.env.${key}`);
      }
    }
    console.log('[next.config.js] Firebase env vars prepared for nextConfig.env:', firebaseEnvVars);
    console.log(`[next.config.js] After direct set, process.env.NEXT_PUBLIC_FIREBASE_API_KEY is: ${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`);

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
  env: firebaseEnvVars, // Assign the loaded Firebase variables here
};

module.exports = nextConfig;

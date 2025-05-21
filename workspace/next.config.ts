
// @ts-check

// Attempt to load environment variables from /workspace/.env specifically for next.config.js context
// This is primarily for diagnostic purposes.
try {
  const dotenv = require('dotenv');
  const path = require('path');
  const envPath = path.resolve(process.cwd(), '.env'); // Assumes .env is in /workspace if cwd is /workspace
  const result = dotenv.config({ path: envPath, override: true }); // override: true to ensure it tries to set them

  if (result.error) {
    console.warn(`[next.config.js] Error loading .env file from ${envPath}:`, result.error.message);
  } else if (result.parsed) {
    console.log(`[next.config.js] Successfully loaded environment variables from ${envPath}`);
    console.log('[next.config.js] Keys loaded by dotenv:', Object.keys(result.parsed));
    
    // Forcefully set them onto process.env within this config file's scope
    // for (const key in result.parsed) {
    //   if (Object.prototype.hasOwnProperty.call(result.parsed, key)) {
    //     process.env[key] = result.parsed[key];
    //     // console.log(`[next.config.js] Directly set process.env.${key}`);
    //   }
    // }
    // console.log(`[next.config.js] After direct set, process.env.NEXT_PUBLIC_FIREBASE_API_KEY is: ${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`);

  } else {
    console.warn(`[next.config.js] No .env file found at ${envPath} or it was empty.`);
  }
} catch (e) {
  console.warn('[next.config.js] dotenv package not found or error during its setup. Proceeding without explicit dotenv loading in next.config.js.', e);
}

import '@/lib/test-import'; // Diagnostic import

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  experimental: {
    allowedDevOrigins: [
      "http://localhost:9004", // Default local dev
      "https://9004-firebase-studio-1747836424073.cluster-3gc7bglotjgwuxlqpiut7yyqt4.cloudworkstations.dev" // Specific domain from error
      // Add other development preview domains if necessary
    ],
  },
  // No explicit env property needed here if Next.js standard .env loading works.
  // If direct setting in this file was needed:
  // env: {
  //   NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  //   // ... other vars
  // }
};

module.exports = nextConfig;

    
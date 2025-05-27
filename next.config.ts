// @ts-check

// Attempt to load environment variables from /workspace/.env specifically for next.config.js context
// This is primarily for diagnostic purposes.
// Note: In a typical Next.js project, you wouldn't usually need to do this in next.config.js
// as Next.js handles .env loading. This is specific to diagnosing potential issues in
// custom environments like Firebase Studio.

// Assuming next.config.ts is at the root, and .env is also at the root.
// If your actual project structure in Firebase Studio differs, this path might need adjustment.
// For instance, if this next.config.ts is at / (root) and .env is at /workspace/.env
// then the path would be './workspace/.env' or an absolute path if `process.cwd()` is not `/`.

try {
  const dotenv = require('dotenv');
  const path = require('path');
  // Try to determine the correct path to .env relative to where next.config.js is executed
  // In Firebase Studio, 'process.cwd()' might be '/home/user/studio'
  // and the .env file is at '/home/user/studio/workspace/.env'
  // So, path.resolve(process.cwd(), 'workspace', '.env') should be correct for Studio.
  // If this next.config.ts is actually /workspace/next.config.ts, then path.resolve(process.cwd(), '.env')
  const envPath = path.resolve(process.cwd(), 'workspace', '.env'); // Adjusted for potential execution from /

  const result = dotenv.config({ path: envPath, override: true });

  if (result.error) {
    console.warn(`[next.config.js - root] Error loading .env file from ${envPath}:`, result.error.message);
  } else if (result.parsed) {
    console.log(`[next.config.js - root] Successfully loaded environment variables from ${envPath}`);
    console.log('[next.config.js - root] Keys loaded by dotenv:', Object.keys(result.parsed));

    // Forcefully set them onto process.env within this config file's scope
    // for (const key in result.parsed) {
    //   if (Object.prototype.hasOwnProperty.call(result.parsed, key)) {
    //     process.env[key] = result.parsed[key];
    //     // console.log(`[next.config.js - root] Directly set process.env.${key}`);
    //   }
    // }
    // console.log(`[next.config.js - root] After direct set, process.env.NEXT_PUBLIC_FIREBASE_API_KEY is: ${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`);

  } else {
    console.warn(`[next.config.js - root] No .env file found at ${envPath} or it was empty.`);
  }
} catch (e) {
  console.warn('[next.config.js - root] dotenv package not found or error during its setup. Proceeding without explicit dotenv loading in next.config.js.', e);
}


import '@/lib/test-import'; // Diagnostic import

/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: Configuration pour l'exportation statique (nécessaire pour Netlify)
  output: 'export',

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true, // Nécessaire pour le déploiement sur Netlify
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    allowedDevOrigins: [
      "http://localhost:9004",
      "https://9004-firebase-studio-1747836424073.cluster-3gc7bglotjgwuxlqpiut7yyqt4.cloudworkstations.dev",
      "https://7b54-34-13-167-125.ngrok-free.app"
    ],
  },
  // Désactiver la minification en développement pour mieux déboguer
  swcMinify: true,
  // Configuration du compilateur
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
};

module.exports = nextConfig;

# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Troubleshooting Firebase Configuration

If you encounter an error like `CRITICAL_FIREBASE_CONFIG_ERROR: Firebase API Key or Project ID is missing... apiKey: 'undefined', projectId: 'undefined'`, it means your Firebase environment variables are not being loaded correctly.

Please ensure you have done the following:

1.  **Create or Verify `.env` File:**
    *   There must be a file named exactly `.env` at the root of your project (i.e., `/workspace/.env`).

2.  **Populate `.env` with Your Credentials:**
    *   Open `/workspace/.env`.
    *   It **must** contain your actual Firebase project credentials, replacing the placeholders. Copy the following structure into your `/workspace/.env` if it's missing or incomplete, and **replace all `YOUR_..._HERE` values with your actual Firebase project details**:
        ```env
        NEXT_PUBLIC_FIREBASE_API_KEY="YOUR_API_KEY_HERE"
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="YOUR_AUTH_DOMAIN_HERE"
        NEXT_PUBLIC_FIREBASE_PROJECT_ID="YOUR_PROJECT_ID_HERE"
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="YOUR_STORAGE_BUCKET_HERE"
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="YOUR_MESSAGING_SENDER_ID_HERE"
        NEXT_PUBLIC_FIREBASE_APP_ID="YOUR_APP_ID_HERE"
        NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="YOUR_MEASUREMENT_ID_HERE"
        ```
    *   You can find these values in your Firebase project settings (Project settings > General > Your apps > Firebase SDK snippet > Config).

3.  **Save the `.env` File.**

4.  **Restart the Next.js Development Server:**
    *   This is a crucial step. Next.js only loads environment variables from the `.env` file when the development server starts.
    *   Stop your server (e.g., Ctrl+C in the terminal where `npm run dev` is running) and then restart it using `npm run dev`.

If the error persists, double-check for typos in your `.env` file and ensure there are no extra spaces around the keys or values.

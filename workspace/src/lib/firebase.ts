
// Firebase App (the core Firebase SDK) is always required and must be listed first
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// **VERY IMPORTANT: CHECK YOUR SERVER CONSOLE (TERMINAL) FOR THIS LOG!**
// This log runs ON THE SERVER when Next.js is building or handling a request.
console.log("================================================================================");
console.log("Firebase Lib Init: ATTEMPTING TO READ FIREBASE ENVIRONMENT VARIABLES");
console.log("--------------------------------------------------------------------------------");
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_API_KEY:         >>>${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:     >>>${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID:      >>>${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:  >>>${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: >>>${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_APP_ID:          >>>${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:  >>>${process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID}<<<`);
console.log("--------------------------------------------------------------------------------");
console.log("If any of the >>>...<<< values above are 'undefined' or show placeholders,");
console.log("your .env file at /workspace/.env is NOT being loaded correctly or is misconfigured.");
console.log("YOU MUST RESTART the Next.js dev server after fixing .env!");
console.log("================================================================================");


const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

console.log(
  "Firebase Config object constructed in /workspace/src/lib/firebase.ts:", firebaseConfig
);

if (
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.trim() === "" ||
  firebaseConfig.apiKey.includes("YOUR_API_KEY") || // General placeholder check
  firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || // Exact placeholder check
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.trim() === "" ||
  firebaseConfig.projectId.includes("YOUR_PROJECT_ID") || // General placeholder check
  firebaseConfig.projectId === "YOUR_PROJECT_ID_HERE" // Exact placeholder check
) {
  const errorMessage =
    "CRITICAL_FIREBASE_CONFIG_ERROR: Firebase API Key or Project ID is missing, empty, or appears to be a placeholder. " +
    "See the **SERVER CONSOLE LOGS** (your terminal) for the exact values Next.js is trying to use. " +
    "Please ensure your .env file at the project root (/workspace/.env) is correctly populated with your ACTUAL Firebase project credentials. " +
    "All NEXT_PUBLIC_FIREBASE_... variables are required. " +
    "After updating the .env file, YOU MUST RESTART the Next.js development server (Ctrl+C, then npm run dev). " +
    `Current (potentially problematic) apiKey: '${firebaseConfig.apiKey}', projectId: '${firebaseConfig.projectId}'. ` +
    "The application cannot start without valid Firebase configuration.";
  // console.error(errorMessage); // User requested to skip this error
  // This will stop execution before Firebase attempts to initialize with bad config, providing a clearer error source.
  // throw new Error(errorMessage); // User requested to skip this error
  console.warn("WARNING: Firebase configuration check bypassed. API Key or Project ID might be missing or invalid. App functionality will likely be impaired.");
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
} catch (error) {
  const initErrorMessage = `Firebase core app initialization (initializeApp) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This usually means the firebaseConfig object itself is malformed or missing critical fields NOT caught by the pre-check (e.g. authDomain, storageBucket if they are truly invalid). Double-check all NEXT_PUBLIC_FIREBASE_... variables in your /workspace/.env file and ensure the server was restarted.`;
  console.error("Error during Firebase app initialization in /workspace/src/lib/firebase.ts:", error);
  console.error(initErrorMessage);
  throw new Error(initErrorMessage);
}

try {
  auth = getAuth(app);
} catch (error) {
  const authErrorMessage = `Firebase Auth setup (getAuth) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This specific error ('${error instanceof Error && (error as any).code ? (error as any).code : 'unknown'}') often points directly to an invalid 'apiKey' or 'authDomain' in your Firebase configuration. Verify these in /workspace/.env and restart the server.`;
  console.error("Error getting Firebase Auth instance in /workspace/src/lib/firebase.ts:", error);
  console.error(authErrorMessage);
  throw new Error(authErrorMessage);
}

try {
  db = getFirestore(app);
} catch (error) {
  const firestoreErrorMessage = `Firestore setup (getFirestore) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This could be due to issues with the 'projectId', database rules, or the Firestore service not being enabled for your project. Check your Firebase console and /workspace/.env file for the 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'. Restart the server after any .env changes.`;
  console.error("Error getting Firestore instance in /workspace/src/lib/firebase.ts:", error);
  console.error(firestoreErrorMessage);
  throw new Error(firestoreErrorMessage);
}

export { app, auth, db };

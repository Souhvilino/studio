
// Firebase App (the core Firebase SDK) is always required and must be listed first
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// **VERY IMPORTANT: CHECK YOUR SERVER CONSOLE (TERMINAL) FOR THIS LOG!**
// This log runs ON THE SERVER when Next.js is building or handling a request.
console.log("================================================================================");
console.log("Firebase Lib Init: ATTEMPTING TO READ FIREBASE ENVIRONMENT VARIABLES (from /workspace/src/lib/firebase.ts)");
console.log("--------------------------------------------------------------------------------");
const rawApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const rawAuthDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const rawProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const rawStorageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
const rawMessagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
const rawAppId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
const rawMeasurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_API_KEY:         >>>${rawApiKey}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:     >>>${rawAuthDomain}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID:      >>>${rawProjectId}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:  >>>${rawStorageBucket}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: >>>${rawMessagingSenderId}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_APP_ID:          >>>${rawAppId}<<<`);
console.log(`RAW process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:  >>>${rawMeasurementId}<<<`);
console.log("--------------------------------------------------------------------------------");
console.log("If any of the >>>...<<< values above are 'undefined' or show placeholders like 'YOUR_..._HERE',");
console.log("your .env file at /workspace/.env is NOT being loaded correctly by Next.js, or it is misconfigured.");
console.log("YOU MUST RESTART the Next.js dev server (Ctrl+C, then 'npm run dev') after fixing /workspace/.env!");
console.log("================================================================================");


const firebaseConfig = {
  apiKey: rawApiKey,
  authDomain: rawAuthDomain,
  projectId: rawProjectId,
  storageBucket: rawStorageBucket,
  messagingSenderId: rawMessagingSenderId,
  appId: rawAppId,
  measurementId: rawMeasurementId,
};

console.log(
  "Firebase Config object constructed in /workspace/src/lib/firebase.ts:", firebaseConfig
);

// More stringent check for API key and Project ID validity before attempting to initialize Firebase
if (
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.trim() === "" ||
  firebaseConfig.apiKey.includes("YOUR_API_KEY") || // Catches "YOUR_API_KEY_HERE" and similar
  firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || // Explicit check for the exact placeholder
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.trim() === "" ||
  firebaseConfig.projectId.includes("YOUR_PROJECT_ID") || // Catches "YOUR_PROJECT_ID_HERE"
  firebaseConfig.projectId === "YOUR_PROJECT_ID_HERE"
) {
  const errorMessage =
    "CRITICAL_FIREBASE_CONFIG_ERROR: Firebase API Key or Project ID is MISSING or uses PLACEHOLDERS in src/lib/firebase.ts. " +
    "This means the environment variables (NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID) were 'undefined' or placeholders when read from 'process.env'. " +
    "VERY IMPORTANT: CHECK THE SERVER CONSOLE LOGS (where you run 'npm run dev') FOR THE 'RAW process.env...' VALUES printed just before this error to see what values the server is actually getting. " +
    "Ensure your /workspace/.env file is correctly named, located at the project root, contains your ACTUAL Firebase credentials (NO placeholders), and that you RESTARTED the Next.js server (Ctrl+C, then 'npm run dev'). " +
    `Problematic apiKey from process.env: '${rawApiKey}', Problematic projectId from process.env: '${rawProjectId}'. ` +
    "The application cannot start without valid Firebase configuration.";
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error(errorMessage);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  // This will stop execution before Firebase attempts to initialize with bad config, providing a clearer error source.
  throw new Error(errorMessage);
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

// Initialize Firebase App
try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }
} catch (error) {
  const initErrorMessage = `Firebase core app initialization (initializeApp) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This usually means the firebaseConfig object itself (apiKey: '${firebaseConfig.apiKey}', projectId: '${firebaseConfig.projectId}') is malformed or missing critical fields NOT caught by the pre-check (e.g. authDomain, storageBucket if they are truly invalid). Double-check all NEXT_PUBLIC_FIREBASE_... variables in your /workspace/.env file and ensure the server was restarted.`;
  console.error("Error during Firebase app initialization in /workspace/src/lib/firebase.ts:", error);
  console.error(initErrorMessage);
  throw new Error(initErrorMessage);
}

// Initialize Firebase Auth
try {
  auth = getAuth(app);
} catch (error) {
  const authErrorMessage = `Firebase Auth setup (getAuth) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This specific error ('${error instanceof Error && (error as any).code ? (error as any).code : 'unknown'}') often points directly to an invalid 'apiKey' ('${firebaseConfig.apiKey}') or 'authDomain' ('${firebaseConfig.authDomain}') in your Firebase configuration. Verify these in /workspace/.env and restart the server.`;
  console.error("Error getting Firebase Auth instance in /workspace/src/lib/firebase.ts:", error);
  console.error(authErrorMessage);
  throw new Error(authErrorMessage);
}

// Initialize Firestore
try {
  db = getFirestore(app);
} catch (error) {
  const firestoreErrorMessage = `Firestore setup (getFirestore) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This could be due to issues with the 'projectId' ('${firebaseConfig.projectId}'), database rules, or the Firestore service not being enabled for your project. Check your Firebase console and /workspace/.env file for the 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'. Restart the server after any .env changes.`;
  console.error("Error getting Firestore instance in /workspace/src/lib/firebase.ts:", error);
  console.error(firestoreErrorMessage);
  throw new Error(firestoreErrorMessage);
}

export { app, auth, db };

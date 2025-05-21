
// Firebase App (the core Firebase SDK) is always required and must be listed first
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// **VERY IMPORTANT: CHECK YOUR SERVER CONSOLE (TERMINAL) FOR THIS LOG!**
// This log runs ON THE SERVER when Next.js is building or handling a request.
console.log("================================================================================");
console.log("Firebase Lib Init: ATTEMPTING TO READ FIREBASE ENVIRONMENT VARIABLES (from src/lib/firebase.ts)");
console.log("File last modified: " + new Date().toISOString()); // To confirm file is being re-read
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
  "Firebase Config object constructed in src/lib/firebase.ts:", firebaseConfig
);

// More stringent check for API key and Project ID validity before attempting to initialize Firebase
if (
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.trim() === "" ||
  firebaseConfig.apiKey.includes("YOUR_API_KEY") ||
  firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || // Explicit check for the exact placeholder
  !firebaseConfig.projectId ||
  firebaseConfig.projectId.trim() === "" ||
  firebaseConfig.projectId.includes("YOUR_PROJECT_ID") ||
  firebaseConfig.projectId === "YOUR_PROJECT_ID_HERE"
) {
  const errorMessage =
    "CRITICAL_FIREBASE_CONFIG_ERROR: Firebase API Key or Project ID is MISSING or uses PLACEHOLDERS in src/lib/firebase.ts. " +
    "This means the environment variables (NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID) were 'undefined' or placeholders when read from 'process.env'. " +
    "Refer to the SERVER CONSOLE LOGS above this message to see the 'RAW process.env...' values. " +
    "Ensure your /workspace/.env file is correctly named, located at the project root, contains your ACTUAL Firebase credentials (NO placeholders), and that you RESTARTED the Next.js server (Ctrl+C, then 'npm run dev'). " +
    `Problematic apiKey from process.env: '${rawApiKey}', Problematic projectId from process.env: '${rawProjectId}'. ` +
    "The application cannot start without valid Firebase configuration.";
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error(errorMessage);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  // This will stop execution before Firebase attempts to initialize with bad config, providing a clearer error source.
  throw new Error(errorMessage);
} else {
  console.log("--------------------------------------------------------------------------------");
  console.log("Firebase Lib: Firebase config pre-check PASSED. API Key and Project ID appear to be validly formatted strings.");
  console.log("Proceeding with Firebase initialization...");
  console.log("================================================================================");
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

console.log(`[${new Date().toISOString()}] PRE-INIT: Attempting Firebase App Initialization with Project ID from firebaseConfig: ${firebaseConfig.projectId}`);

// Initialize Firebase App
try {
  if (getApps().length === 0) {
    app = initializeApp(firebaseConfig);
    console.log(`[${new Date().toISOString()}] POST-INIT: Firebase App Initialized successfully. App Name: ${app.name}, App Project ID from app.options: ${app.options.projectId}`);
  } else {
    app = getApp();
    console.log(`[${new Date().toISOString()}] POST-INIT: Existing Firebase App retrieved. App Name: ${app.name}, App Project ID from app.options: ${app.options.projectId}`);
  }
} catch (error) {
  const initErrorMessage = `Firebase core app initialization (initializeApp) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This usually means the firebaseConfig object itself (apiKey: '${firebaseConfig.apiKey}', projectId: '${firebaseConfig.projectId}') is malformed or missing critical fields NOT caught by the pre-check. Double-check all NEXT_PUBLIC_FIREBASE_... variables in your /workspace/.env file and ensure the server was restarted.`;
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("Error during Firebase app initialization in src/lib/firebase.ts:", error);
  console.error(initErrorMessage);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  throw new Error(initErrorMessage);
}

// Initialize Firebase Auth
try {
  console.log(`[${new Date().toISOString()}] PRE-AUTH: Attempting Auth Initialization. Using app with Project ID: ${app?.options?.projectId}`);
  auth = getAuth(app);
  console.log(`[${new Date().toISOString()}] POST-AUTH: Firebase Auth Initialized successfully for Project ID: ${app?.options?.projectId}`);
} catch (error) {
  const authErrorMessage = `Firebase Auth setup (getAuth) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This specific error ('${error instanceof Error && (error as any).code ? (error as any).code : 'unknown'}') often points directly to an invalid 'apiKey' ('${app?.options?.apiKey || firebaseConfig.apiKey}') or 'authDomain' ('${app?.options?.authDomain || firebaseConfig.authDomain}') in your Firebase configuration. Verify these in /workspace/.env and restart the server. Current Project ID being used: '${app?.options?.projectId || firebaseConfig.projectId}'`;
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("Error getting Firebase Auth instance in src/lib/firebase.ts:", error);
  console.error(authErrorMessage);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  throw new Error(authErrorMessage);
}

// Initialize Firestore
try {
  console.log(`[${new Date().toISOString()}] PRE-FIRESTORE: Attempting Firestore Initialization. Using app with Project ID: ${app?.options?.projectId}`);
  db = getFirestore(app);
  console.log(`[${new Date().toISOString()}] POST-FIRESTORE: Firestore Initialized successfully for Project ID: ${app?.options?.projectId}`);
} catch (error) {
  const firestoreErrorMessage = `Firestore setup (getFirestore) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This DIRECTLY indicates an issue with Firestore for project ID '${app?.options?.projectId || firebaseConfig.projectId}'. 
  TROUBLESHOOTING STEPS:
  1. VERIFY Firestore is ENABLED for project '${app?.options?.projectId || firebaseConfig.projectId}' in the Firebase Console (Build > Firestore Database > Create database).
  2. If you just enabled it, WAIT a few minutes for propagation, then do a FULL SERVER RESTART.
  3. Ensure you completed ALL steps of Firestore creation, including selecting a REGION and starting in TEST MODE (or with appropriate security rules).
  4. Double-check that 'NEXT_PUBLIC_FIREBASE_PROJECT_ID' in your /workspace/.env file EXACTLY matches this project ID: '${app?.options?.projectId || firebaseConfig.projectId}'.
  5. RESTART the Next.js server completely (Ctrl+C, then 'npm run dev') after any .env or Firebase console changes.
  Error details: ${error instanceof Error ? error.message : String(error)}`;
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("Error getting Firestore instance in src/lib/firebase.ts:", error);
  console.error(firestoreErrorMessage);
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  throw new Error(firestoreErrorMessage);
}

export { app, auth, db };

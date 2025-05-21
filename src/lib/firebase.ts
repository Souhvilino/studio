
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
// import { getFunctions, Functions } from "firebase/functions"; // If needed later for matching etc.
// import { getStorage, FirebaseStorage } from "firebase/storage"; // If vision API needs direct upload

// **VERY IMPORTANT: CHECK YOUR SERVER CONSOLE FOR THIS LOG!**
// console.log(
//   "Firebase Lib Init: Reading Environment Variables from process.env:",
//   `NEXT_PUBLIC_FIREBASE_API_KEY: >>>${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}<<<`,
//   `NEXT_PUBLIC_FIREBASE_PROJECT_ID: >>>${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}<<<`,
//   `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: ${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}`,
//   `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: ${process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}`,
//   `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: ${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}`,
//   `NEXT_PUBLIC_FIREBASE_APP_ID: ${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`,
//   `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: ${process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID}`
// );
// Replaced by more detailed logging block below

console.log("================================================================================");
console.log("Firebase Lib Init: ATTEMPTING TO READ FIREBASE ENVIRONMENT VARIABLES (from src/lib/firebase.ts)");
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
    "CRITICAL_FIREBASE_CONFIG_ERROR: Firebase API Key or Project ID is missing, empty, or appears to be a placeholder. " +
    "Please ensure your .env file at the project root (/workspace/.env) is correctly populated with your ACTUAL Firebase project credentials. " +
    "All NEXT_PUBLIC_FIREBASE_... variables are required, especially NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID. " +
    "After updating the .env file, YOU MUST RESTART the Next.js development server. " +
    `Current (potentially problematic) apiKey: '${firebaseConfig.apiKey}', projectId: '${firebaseConfig.projectId}'. ` +
    "The application cannot start without valid Firebase configuration.";
  // console.error(errorMessage); // User requested to skip this error
  // This will stop execution before Firebase attempts to initialize with bad config, providing a clearer error source.
  // throw new Error(errorMessage); // User requested to skip this error
  console.warn("WARNING: Firebase configuration check bypassed in src/lib/firebase.ts. API Key or Project ID might be missing or invalid. App functionality will likely be impaired.");
}

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
// let functions: Functions;
// let storage: FirebaseStorage;

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
  }. This usually means the firebaseConfig object itself is malformed or missing critical fields NOT caught by the pre-check (e.g. authDomain, storageBucket if they are truly invalid). Double-check all NEXT_PUBLIC_FIREBASE_... variables in your /workspace/.env file and ensure the server was restarted.`;
  console.error("Error during Firebase app initialization in src/lib/firebase.ts:", error);
  console.error(initErrorMessage);
  throw new Error(initErrorMessage);
}

// Initialize Firebase Auth
try {
  auth = getAuth(app);
} catch (error) {
  const authErrorMessage = `Firebase Auth setup (getAuth) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This specific error ('${error instanceof Error && (error as any).code ? (error as any).code : 'unknown'}') often points directly to an invalid 'apiKey' or 'authDomain' in your Firebase configuration. Verify these in /workspace/.env and restart the server.`;
  console.error("Error getting Firebase Auth instance in src/lib/firebase.ts:", error);
  console.error(authErrorMessage);
  throw new Error(authErrorMessage);
}

// Initialize Firestore
try {
  db = getFirestore(app);
} catch (error) {
  const firestoreErrorMessage = `Firestore setup (getFirestore) failed: ${
    error instanceof Error ? error.message : String(error)
  }. This could be due to issues with the 'projectId', database rules, or the Firestore service not being enabled for your project. Check your Firebase console and /workspace/.env file for the 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'. Restart the server after any .env changes.`;
  console.error("Error getting Firestore instance in src/lib/firebase.ts:", error);
  console.error(firestoreErrorMessage);
  throw new Error(firestoreErrorMessage);
}

// functions = getFunctions(app); // Initialize if you use callable functions
// storage = getStorage(app); // Initialize if you use Firebase Storage

export { app, auth, db };

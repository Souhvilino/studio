
"use client";

import type { ReactNode } from "react";
import React, { useEffect, useState, createContext, useContext } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously, User, type FirebaseError } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FirebaseAuthContextType {
  user: User | null;
  loading: boolean;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined);

export const useFirebaseAuth = () => {
  const context = useContext(FirebaseAuthContext);
  if (context === undefined) {
    throw new Error("useFirebaseAuth must be used within a FirebaseAuthProvider");
  }
  return context;
};

interface FirebaseAuthProviderProps {
  children: ReactNode;
}

export function FirebaseAuthProvider({ children }: FirebaseAuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    console.log("[AuthProvider] useEffect triggered. Initializing auth state listener.");
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("[AuthProvider] onAuthStateChanged fired. currentUser:", currentUser ? currentUser.uid : null);
      if (currentUser) {
        setUser(currentUser);
        console.log("[AuthProvider] Existing user found:", currentUser.uid);
        setLoading(false);
        console.log("[AuthProvider] Set loading to false (existing user).");
      } else {
        console.log("[AuthProvider] No current user, attempting signInAnonymously...");
        try {
          const userCredential = await signInAnonymously(auth);
          setUser(userCredential.user);
          console.log("[AuthProvider] signInAnonymously successful. User UID:", userCredential.user?.uid);
          setLoading(false);
          console.log("[AuthProvider] Set loading to false (anonymous sign-in successful).");
        } catch (error) {
          console.error("[AuthProvider] Error signing in anonymously:", error);
          const firebaseError = error as FirebaseError;
          let description = `Could not sign in anonymously: ${firebaseError.message}`;
          if (firebaseError.code === 'auth/configuration-not-found') {
            description = "Please enable Anonymous sign-in in your Firebase project's Authentication settings (Sign-in method tab).";
          } else if (firebaseError.code === 'auth/invalid-api-key') {
            description = "Firebase API Key is invalid. Please check your .env configuration and Firebase project settings.";
          }
          // Add more specific error handling if needed
          else if (firebaseError.code === 'auth/network-request-failed') {
            description = "Network error during anonymous sign-in. Please check your internet connection and Firebase service status.";
          } else if (firebaseError.code === 'auth/too-many-requests') {
            description = "Too many anonymous sign-in attempts. Please try again later (Firebase quota might be exceeded for auth operations).";
          }

          toast({
            variant: "destructive",
            title: `Authentication Error (${firebaseError.code || 'Unknown'})`,
            description: description,
            duration: 10000, 
          });
          // Even on error, we should stop loading to not get stuck,
          // though the app might not function fully.
          // Or, decide if you want to keep it loading on unrecoverable errors.
          // For now, let's set loading to false to allow UI to render (even if it's an error state).
          setLoading(false); 
          console.log("[AuthProvider] Set loading to false (anonymous sign-in error).");
        }
      }
    });

    return () => {
      console.log("[AuthProvider] useEffect cleanup. Unsubscribing from onAuthStateChanged.");
      unsubscribe();
    };
  }, [toast]); // toast is stable

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-foreground">Initializing Chatter Anon...</p>
      </div>
    );
  }

  return (
    <FirebaseAuthContext.Provider value={{ user, loading }}>
      {children}
    </FirebaseAuthContext.Provider>
  );
}


"use client";

import type { ReactNode } from "react";
import React, { useEffect, useState, createContext, useContext } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously, User, type FirebaseError } from "firebase/auth";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast"; // Added useToast

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
  const { toast } = useToast(); // Initialize toast

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        // If no user, sign in anonymously
        try {
          const userCredential = await signInAnonymously(auth);
          setUser(userCredential.user);
        } catch (error) {
          console.error("Error signing in anonymously:", error);
          const firebaseError = error as FirebaseError;
          if (firebaseError.code === 'auth/configuration-not-found') {
            toast({
              variant: "destructive",
              title: "Anonymous Sign-In Disabled",
              description: "Please enable Anonymous sign-in in your Firebase project's Authentication settings (Sign-in method tab).",
              duration: 10000, // Show for longer
            });
          } else {
            toast({
              variant: "destructive",
              title: "Authentication Error",
              description: `Could not sign in anonymously: ${firebaseError.message}`,
            });
          }
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [toast]); // Added toast to dependency array

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

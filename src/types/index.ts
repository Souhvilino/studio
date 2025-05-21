export interface ChatMessage {
  id: string;
  userId: string;
  text: string;
  timestamp: Date;
  isLocalUser: boolean;
  originalText?: string; // For storing original text if translated
  translatedText?: string; // For storing translated text
  translationError?: string; // If translation fails
  isTranslating?: boolean; // To show loading state for translation
}

export type ChatState = "idle" | "searching" | "connecting" | "chatting" | "error";

export interface ReportData {
  reportedUserId: string;
  reportingUserId: string;
  reason: string;
  roomId: string | null;
  timestamp?: any; // Firestore ServerTimestamp
}

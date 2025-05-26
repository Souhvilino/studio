
import type { Timestamp } from 'firebase/firestore';
import type { GetIpLocationOutput } from '@/ai/flows/get-ip-location-flow';

export interface ChatMessage {
  id: string;
  userId: string;
  text: string;
  timestamp: Date; // Converted to Date on client
  isLocalUser: boolean;
  originalText?: string;
  translatedText?: string;
  translationError?: string;
  isTranslating?: boolean;
}

export type ChatState = "idle" | "searching" | "connecting" | "chatting" | "error";

export interface ReportData {
  id?: string; // Document ID from Firestore
  reportedUserId: string;
  reportingUserId: string;
  reason: string;
  roomId: string | null;
  timestamp?: any; // Firestore ServerTimestamp from write, Firestore Timestamp on read
  timestampDate?: Date; // JavaScript Date object for client-side use
  screenshotUrl?: string; // URL of the uploaded screenshot
  reporterLocationData?: GetIpLocationOutput; // Geolocation data of the reporter (server-approximated by the flow's execution context)
}

export interface UserStatusData {
  userId: string;
  status: 'searching' | 'chatting' | 'idle';
  keywords?: string[];
  lastSeen: any; // Firestore ServerTimestamp
  roomId?: string | null;
}

export interface RoomData {
  id: string;
  users: string[];
  keywords?: string[];
  createdAt: any; // Firestore ServerTimestamp
  status: 'pending' | 'active' | 'closed'; // pending could be for signaling
  endedAt?: any; // Firestore ServerTimestamp
}

export interface SignalPayload {
  type: 'offer' | 'answer' | 'candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit | RTCIceCandidate;
}

export interface SignalData {
  senderId: string;
  receiverId: string;
  signal: SignalPayload;
  timestamp: any; // Firestore ServerTimestamp
}

import { db } from './firebase';
import { collection, addDoc, query, where, getDocs, doc, updateDoc, onSnapshot, serverTimestamp, limit, orderBy, startAfter, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import type { ChatMessage, ReportData } from '@/types';

// --- User Status and Matching (STUBBED) ---
interface UserStatus {
  userId: string;
  status: 'searching' | 'chatting' | 'idle';
  keywords?: string[];
  lastSeen: any; // serverTimestamp
  roomId?: string | null;
}

export async function updateUserStatus(userId: string, status: UserStatus['status'], keywords?: string[], roomId?: string | null): Promise<void> {
  console.log(`FirestoreService: Updating status for user ${userId} to ${status}`, { keywords, roomId });
  // In a real app:
  // const userStatusRef = doc(db, 'userStatuses', userId);
  // await setDoc(userStatusRef, { userId, status, keywords: keywords || [], lastSeen: serverTimestamp(), roomId: roomId || null }, { merge: true });
  return Promise.resolve();
}

export async function findMatch(userId: string, keywords?: string[]): Promise<UserStatus | null> {
  console.log(`FirestoreService: User ${userId} finding match with keywords: ${keywords?.join(', ')}`);
  // In a real app:
  // Query 'userStatuses' for users with status 'searching'
  // Implement matching logic based on keywords or find any available user
  // Create a room and update both users' statuses to 'chatting' with the roomId
  // This is complex and would involve transactions or a Cloud Function for reliability.
  // For MVP, this might return a mock user or involve simpler query.
  
  // Simple stub: if another user 'testUser2' is searching, match with them.
  // const q = query(collection(db, "userStatuses"), where("status", "==", "searching"), where("userId", "!=", userId), limit(1));
  // const querySnapshot = await getDocs(q);
  // if (!querySnapshot.empty) {
  //   return querySnapshot.docs[0].data() as UserStatus;
  // }
  return Promise.resolve(null); // Placeholder
}

// --- WebRTC Signaling (STUBBED) ---
export async function sendSignal(roomId: string, userId: string, signalData: any): Promise<void> {
  console.log(`FirestoreService: Sending signal in room ${roomId} for user ${userId}`, signalData);
  // In a real app:
  // const signalsCollection = collection(db, `rooms/${roomId}/users/${userId}/signals`);
  // await addDoc(signalsCollection, { ...signalData, timestamp: serverTimestamp() });
  // Or, more simply, update fields on the room document or user-specific sub-collections.
  return Promise.resolve();
}

export function listenForSignals(roomId: string, targetUserId: string, callback: (signalData: any) => void): () => void {
  console.log(`FirestoreService: Listening for signals in room ${roomId} for target user ${targetUserId}`);
  // In a real app:
  // const signalsCollection = collection(db, `rooms/${roomId}/users/${targetUserId}/signals`);
  // const q = query(signalsCollection, orderBy("timestamp", "asc"));
  // const unsubscribe = onSnapshot(q, (snapshot) => {
  //   snapshot.docChanges().forEach((change) => {
  //     if (change.type === "added") {
  //       callback(change.doc.data());
  //     }
  //   });
  // });
  // return unsubscribe;
  return () => {}; // Placeholder for unsubscribe function
}

// --- Chat Messages ---
export async function sendMessage(roomId: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> & { timestamp?: any }): Promise<string> {
  console.log(`FirestoreService: Sending message to room ${roomId}`, message);
  const messagesCollection = collection(db, `rooms/${roomId}/messages`);
  const docRef = await addDoc(messagesCollection, {
    ...message,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

export function listenForMessages(
  roomId: string,
  callback: (messages: ChatMessage[]) => void,
  lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize: number = 20
): () => void {
  console.log(`FirestoreService: Listening for messages in room ${roomId}`);
  let q = query(
    collection(db, `rooms/${roomId}/messages`),
    orderBy('timestamp', 'desc'),
    limit(pageSize)
  );

  if (lastVisibleDoc) {
    q = query(q, startAfter(lastVisibleDoc));
  }
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate() || new Date(), // Convert Firestore Timestamp
    } as ChatMessage)).reverse(); // Reverse to show newest at bottom
    callback(messages);
  });
  return unsubscribe;
}

// --- Reporting ---
export async function createReport(reportData: ReportData): Promise<void> {
  console.log(`FirestoreService: Creating report`, reportData);
  const reportsCollection = collection(db, 'reports');
  await addDoc(reportsCollection, {
    ...reportData,
    timestamp: serverTimestamp(),
  });
}

// --- Room Management (STUBBED) ---
export async function createRoom(userId1: string, userId2: string, keywords?: string[]): Promise<string> {
  console.log(`FirestoreService: Creating room for ${userId1} and ${userId2} with keywords: ${keywords?.join(', ')}`);
  // In a real app:
  // const roomsCollection = collection(db, 'rooms');
  // const roomDoc = await addDoc(roomsCollection, {
  //   users: [userId1, userId2],
  //   keywords: keywords || [],
  //   createdAt: serverTimestamp(),
  //   status: 'active', // or 'signaling'
  // });
  // return roomDoc.id;
  return Promise.resolve("mockRoomId123"); // Placeholder
}

export async function cleanupRoom(roomId: string): Promise<void> {
  console.log(`FirestoreService: Cleaning up room ${roomId}`);
  // In a real app:
  // Update room status to 'closed' or delete the room document and its subcollections.
  // This might involve deleting messages, signals, etc.
  // const roomRef = doc(db, 'rooms', roomId);
  // await updateDoc(roomRef, { status: 'closed', endedAt: serverTimestamp() });
  return Promise.resolve();
}

export async function getRoomData(roomId: string): Promise<any | null> {
  console.log(`FirestoreService: Getting room data for ${roomId}`);
  // const roomRef = doc(db, 'rooms', roomId);
  // const roomSnap = await getDoc(roomRef);
  // if (roomSnap.exists()) {
  //   return roomSnap.data();
  // }
  return Promise.resolve(null);
}

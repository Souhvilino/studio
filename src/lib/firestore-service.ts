
import { db } from './firebase';
import { 
  collection, addDoc, query, where, getDocs, doc, updateDoc, onSnapshot, 
  serverTimestamp, limit, orderBy, setDoc, getDoc, writeBatch, type QuerySnapshot, type DocumentData, type QueryDocumentSnapshot, Timestamp, startAfter 
} from 'firebase/firestore';
import type { ChatMessage, ReportData, UserStatusData, RoomData, SignalData, SignalPayload } from '@/types';

// --- User Status and Matching ---

export async function updateUserStatus(userId: string, status: UserStatusData['status'], keywords?: string[], roomId?: string | null): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] updateUserStatus for ${userId}: status=${status}, roomId=${roomId === undefined ? 'not specified' : roomId}, keywords=${keywords?.join(',')}`);
  const userStatusRef = doc(db, 'userStatuses', userId);
  const data: Partial<UserStatusData> = {
    status,
    lastSeen: serverTimestamp(), // Firestore server timestamp for accuracy
  };
  if (keywords !== undefined) data.keywords = keywords;
  if (roomId !== undefined) data.roomId = roomId; 

  try {
    await setDoc(userStatusRef, data, { merge: true });
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] User status successfully updated for ${userId} to ${status}.`);
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error updating user status for ${userId}:`, error);
    throw error;
  }
}


export async function findMatch(currentUserId: string, searchKeywords?: string[]): Promise<UserStatusData | null> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch called for ${currentUserId} with keywords:`, searchKeywords);
  let q;
  const usersRef = collection(db, "userStatuses");
  // Consider users active in the last 2 minutes for matching to avoid matching with stale entries
  const twoMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 2 * 60 * 1000));

  if (searchKeywords && searchKeywords.length > 0) {
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Searching with keywords: ${searchKeywords.slice(0,10).join(', ')} for user ${currentUserId}`);
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId), // Don't match with self
      where("keywords", "array-contains-any", searchKeywords.slice(0,10)), 
      where("lastSeen", ">", twoMinutesAgo), 
      orderBy("lastSeen", "asc"),
      limit(10) 
    );
  } else {
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Searching for any user (no keywords) for user ${currentUserId}.`);
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId),
      where("lastSeen", ">", twoMinutesAgo),
      orderBy("lastSeen", "asc"),
      limit(1)
    );
  }

  try {
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const matchedDoc = querySnapshot.docs[0]; // Prioritize the one waiting longest
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Match found for ${currentUserId}: ${matchedDoc.id}`, matchedDoc.data());
      return { userId: matchedDoc.id, ...matchedDoc.data() } as UserStatusData;
    }
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] No match found for ${currentUserId}`);
    return null;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error in findMatch for ${currentUserId}:`, error);
    return null;
  }
}

// --- Room Management ---
export async function createRoom(userId1: string, userId2: string, keywordsUsed?: string[]): Promise<string> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createRoom called for users: ${userId1}, ${userId2}`);
  const roomsCollection = collection(db, 'rooms');
  const roomDocRef = doc(roomsCollection); 

  const roomData: RoomData = {
    id: roomDocRef.id,
    users: [userId1, userId2],
    keywords: keywordsUsed || [],
    createdAt: serverTimestamp(),
    status: 'active', 
  };
  
  const batch = writeBatch(db);
  batch.set(roomDocRef, roomData);
  
  const user1StatusRef = doc(db, 'userStatuses', userId1);
  batch.update(user1StatusRef, { status: 'chatting', roomId: roomDocRef.id, keywords: [] });

  const user2StatusRef = doc(db, 'userStatuses', userId2);
  batch.update(user2StatusRef, { status: 'chatting', roomId: roomDocRef.id, keywords: [] });
  
  try {
    await batch.commit();
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Room ${roomDocRef.id} created and user statuses (for ${userId1}, ${userId2}) updated to 'chatting'.`);
    return roomDocRef.id;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error committing batch for createRoom:`, error);
    throw error; 
  }
}

export async function getRoomData(roomId: string): Promise<RoomData | null> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] getRoomData called for roomId: ${roomId}`);
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (roomSnap.exists()) {
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Room data found for ${roomId}:`, roomSnap.data());
    return { id: roomSnap.id, ...roomSnap.data() } as RoomData;
  }
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] No room data found for ${roomId}`);
  return null;
}

export async function cleanupRoom(roomId: string, currentUserId: string): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom called for roomId: ${roomId} by user: ${currentUserId}`);
  const roomRef = doc(db, 'rooms', roomId);
  const batch = writeBatch(db);

  try {
    const roomData = await getRoomData(roomId); // This already logs
    if (roomData) {
      // Update status for all users in the room to idle
      roomData.users.forEach(userId => {
        const userStatusRef = doc(db, 'userStatuses', userId);
        batch.update(userStatusRef, { status: 'idle', roomId: null, keywords: [] });
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for ${userId} to idle.`);
      });
      // Mark room as closed
      batch.update(roomRef, { status: 'closed', endedAt: serverTimestamp() });
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for room ${roomId} to closed.`);
    } else {
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Room ${roomId} not found. Only updating initiating user ${currentUserId} status if they were not idle.`);
        // If room doesn't exist, at least update the current user if they thought they were in a room.
        const currentUserStatusRef = doc(db, 'userStatuses', currentUserId);
        // Fetch current status to avoid unnecessary write if already idle
        const currentUserStatusSnap = await getDoc(currentUserStatusRef);
        if(currentUserStatusSnap.exists() && currentUserStatusSnap.data().status !== 'idle') {
            batch.update(currentUserStatusRef, { status: 'idle', roomId: null, keywords: [] });
        }
    }
    await batch.commit();
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Batch committed for room ${roomId}.`);
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error cleaning up room ${roomId}:`, error);
    // Fallback: try to update current user's status at least
    const currentUserStatusRef = doc(db, 'userStatuses', currentUserId);
    await updateUserStatus(currentUserId, 'idle', [], null).catch(err => console.error("Fallback user status update failed:", err));
  }
}


// --- WebRTC Signaling ---
export async function sendSignal(roomId: string, senderId: string, receiverId: string, signal: SignalPayload): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] sendSignal from ${senderId} to ${receiverId} in room ${roomId}: type=${signal.type}`);
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  const signalDataToSend: SignalData = {
    senderId,
    receiverId,
    signal, 
    timestamp: serverTimestamp(),
  };
  await addDoc(signalsCollection, signalDataToSend);
}


export function listenForSignals(roomId: string, currentUserId: string, callback: (signalPayload: SignalPayload) => void): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  console.log(`[FirestoreService][${listenStartMs}] listenForSignals setup for user ${currentUserId} in room ${roomId}`);
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  
  // Only listen for signals created after this listener was initialized.
  const q = query(
    signalsCollection, 
    where("receiverId", "==", currentUserId),
    where("timestamp", ">", Timestamp.fromMillis(listenStartMs)), // Query for newer signals
    orderBy("timestamp", "asc") 
  );
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data() as SignalData;
        console.log(`[FirestoreService][${Timestamp.now().toMillis()}] Received signal for ${currentUserId} in room ${roomId}: type=${data.signal.type}, sender=${data.senderId}`);
        callback(data.signal);
      }
    });
  }, (error) => {
    console.error(`[FirestoreService][${Timestamp.now().toMillis()}] Error listening for signals in room ${roomId} for user ${currentUserId}:`, error);
  });
  return unsubscribe;
}


// --- Chat Messages ---
export async function sendMessage(roomId: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> & { timestamp?: any }): Promise<string> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] sendMessage to room ${roomId}:`, message.text.substring(0, 20) + "...");
  const messagesCollection = collection(db, `rooms/${roomId}/messages`);
  const docRef = await addDoc(messagesCollection, {
    ...message,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

export function listenForMessages(
  roomId: string,
  callback: (messages: ChatMessage[], newLastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null) => void,
  _lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  _pageSize: number = 50 
): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  console.log(`[FirestoreService][${listenStartMs}] listenForMessages setup for room ${roomId}`);
  
  const q = query(
    collection(db, `rooms/${roomId}/messages`),
    orderBy('timestamp', 'asc')
  );
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const newMessages: ChatMessage[] = [];
    snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
            const data = change.doc.data();
            // Filter messages that are newer than when the listener started, if desired, though 'added' should handle this for new messages.
            // const messageTimestamp = (data.timestamp as Timestamp)?.toMillis();
            // if (!messageTimestamp || messageTimestamp >= listenStartMs) {
              newMessages.push({
                  id: change.doc.id,
                  ...data,
                  timestamp: (data.timestamp as Timestamp)?.toDate() || new Date(),
              } as ChatMessage);
            // }
        }
    });

    if (newMessages.length > 0) {
      console.log(`[FirestoreService][${Timestamp.now().toMillis()}] listenForMessages: ${newMessages.length} new messages for room ${roomId}`);
      callback(newMessages, snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null);
    }
  }, (error) => {
    console.error(`[FirestoreService][${Timestamp.now().toMillis()}] Error listening for messages in room ${roomId}:`, error);
  });
}


// --- Reporting ---
export async function createReport(reportData: ReportData): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createReport called for user: ${reportData.reportedUserId}`);
  const reportsCollection = collection(db, 'reports');
  await addDoc(reportsCollection, {
    ...reportData,
    timestamp: serverTimestamp(),
  });
}
    

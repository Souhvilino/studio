
import { db } from './firebase';
import { 
  collection, addDoc, query, where, getDocs, doc, updateDoc, onSnapshot, 
  serverTimestamp, limit, orderBy, setDoc, getDoc, writeBatch, type QuerySnapshot, type DocumentData, type QueryDocumentSnapshot, Timestamp, startAfter, getCountFromServer 
} from 'firebase/firestore';
import type { ChatMessage, ReportData, UserStatusData, RoomData, SignalData, SignalPayload } from '@/types';

// --- User Status and Matching ---

export async function updateUserStatus(userId: string, status: UserStatusData['status'], keywords?: string[], roomId?: string | null): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] updateUserStatus for ${userId}: status=${status}, roomId=${roomId === undefined ? 'not specified' : roomId}, keywords=${keywords?.join(',')}`);
  const userStatusRef = doc(db, 'userStatuses', userId);
  const data: Partial<UserStatusData> = {
    userId, 
    status,
    lastSeen: serverTimestamp(), 
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
  let q;
  const usersRef = collection(db, "userStatuses");
  const fiveMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
  let queryString = ""; // For logging

  if (searchKeywords && searchKeywords.length > 0) {
    const effectiveKeywords = searchKeywords.slice(0,10);
    queryString = `status == searching, userId != ${currentUserId}, keywords array-contains-any [${effectiveKeywords.join(', ')}], lastSeen > 5minAgo, orderBy lastSeen asc, limit 1`;
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId}: Querying WITH keywords: [${effectiveKeywords.join(', ')}]`);
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId), 
      where("keywords", "array-contains-any", effectiveKeywords), 
      where("lastSeen", ">", fiveMinutesAgo), 
      orderBy("lastSeen", "asc"),
      limit(1) 
    );
  } else {
    queryString = `status == searching, userId != ${currentUserId}, lastSeen > 5minAgo, orderBy lastSeen asc, limit 1`;
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId}: Querying WITHOUT keywords.`);
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId),
      where("lastSeen", ">", fiveMinutesAgo),
      orderBy("lastSeen", "asc"),
      limit(1)
    );
  }

  try {
    const querySnapshot = await getDocs(q);
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId}: Query executed: "${queryString}". Snapshot empty: ${querySnapshot.empty}. Docs found: ${querySnapshot.size}`);
    if (!querySnapshot.empty) {
      const matchedDoc = querySnapshot.docs[0]; 
      const matchedData = { userId: matchedDoc.id, ...matchedDoc.data() } as UserStatusData;
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Match found for ${currentUserId}: ${matchedDoc.id}`, matchedData);
      return matchedData;
    }
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] No match found via query for ${currentUserId}. Query: "${queryString}"`);
    return null;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error in findMatch for ${currentUserId} with query "${queryString}":`, error);
    return null;
  }
}

export async function getActiveUserCount(): Promise<number> {
  const fiveMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
  const usersRef = collection(db, "userStatuses");
  const q = query(
    usersRef,
    where("lastSeen", ">", fiveMinutesAgo)
  );
  try {
    const snapshot = await getCountFromServer(q);
    console.log(`[FirestoreService] Active user count: ${snapshot.data().count}`);
    return snapshot.data().count;
  } catch (error) {
    console.error("[FirestoreService] Error fetching active user count:", error);
    return 0; 
  }
}

// --- Room Management ---
export async function createRoom(userId1: string, userId2: string, keywordsUsed?: string[]): Promise<string> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createRoom called for users: ${userId1}, ${userId2} with keywords: [${(keywordsUsed || []).join(',')}]`);
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
  batch.update(user1StatusRef, { status: 'chatting', roomId: roomDocRef.id, keywords: [] }); // Clear keywords on match

  const user2StatusRef = doc(db, 'userStatuses', userId2);
  batch.update(user2StatusRef, { status: 'chatting', roomId: roomDocRef.id, keywords: [] }); // Clear keywords on match
  
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
    const data = { id: roomSnap.id, ...roomSnap.data() } as RoomData;
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Room data found for ${roomId}:`, data);
    return data;
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
    const roomData = await getRoomData(roomId); 
    if (roomData && roomData.status !== 'closed') { // Only cleanup active/pending rooms
      roomData.users.forEach(userId => {
        const userStatusRef = doc(db, 'userStatuses', userId);
        // Only set to idle if they are currently associated with this room or chatting
        // This avoids race conditions if user quickly joined another room
        batch.update(userStatusRef, { status: 'idle', roomId: null, keywords: [] });
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for ${userId} to idle (from room ${roomId}).`);
      });
      batch.update(roomRef, { status: 'closed', endedAt: serverTimestamp() });
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for room ${roomId} to closed.`);
    } else if (roomData && roomData.status === 'closed') {
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Room ${roomId} is already closed. Ensuring initiating user ${currentUserId} is idle.`);
       const currentUserStatusRef = doc(db, 'userStatuses', currentUserId);
       const currentUserStatusSnap = await getDoc(currentUserStatusRef);
       if(currentUserStatusSnap.exists() && currentUserStatusSnap.data().roomId === roomId) { // Only update if still in this room
           batch.update(currentUserStatusRef, { status: 'idle', roomId: null, keywords: [] });
       }
    } else {
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Room ${roomId} not found. Only updating initiating user ${currentUserId} status if they were not idle.`);
        const currentUserStatusRef = doc(db, 'userStatuses', currentUserId);
        const currentUserStatusSnap = await getDoc(currentUserStatusRef);
        if(currentUserStatusSnap.exists() && currentUserStatusSnap.data().status !== 'idle') {
            batch.update(currentUserStatusRef, { status: 'idle', roomId: null, keywords: [] });
        }
    }
    await batch.commit();
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Batch committed for room ${roomId}.`);
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error cleaning up room ${roomId}:`, error);
    // Fallback for the current user if batch fails
    await updateUserStatus(currentUserId, 'idle', [], null).catch(err => console.error("[FirestoreService] Fallback user status update failed:", err));
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
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Signal type ${signal.type} sent successfully from ${senderId} to ${receiverId} in room ${roomId}.`);
}


export function listenForSignals(roomId: string, currentUserId: string, callback: (signalPayload: SignalPayload) => void): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  console.log(`[FirestoreService][${listenStartMs}] listenForSignals setup for user ${currentUserId} in room ${roomId}, listening for signals where receiverId is ${currentUserId}`);
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  
  const q = query(
    signalsCollection, 
    where("receiverId", "==", currentUserId),
    where("timestamp", ">", Timestamp.fromMillis(listenStartMs - 5000)), // Listen for signals slightly in the past too
    orderBy("timestamp", "asc") 
  );
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data() as SignalData;
        console.log(`[FirestoreService][${Timestamp.now().toMillis()}] Received signal for ${currentUserId} in room ${roomId}: type=${data.signal.type}, sender=${data.senderId}, docId=${change.doc.id}`);
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
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] sendMessage to room ${roomId}: "${message.text.substring(0, 30)}${message.text.length > 30 ? '...' : ''}" by user ${message.userId}`);
  const messagesCollection = collection(db, `rooms/${roomId}/messages`);
  const docRef = await addDoc(messagesCollection, {
    ...message,
    timestamp: serverTimestamp(),
  });
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Message sent to room ${roomId}, new message ID: ${docRef.id}`);
  return docRef.id;
}

export function listenForMessages(
  roomId: string,
  callback: (messages: ChatMessage[], newLastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null) => void,
  _lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null, // Not currently used for pagination
  _pageSize: number = 50 // Not currently used for pagination
): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  console.log(`[FirestoreService][${listenStartMs}] listenForMessages setup for room ${roomId}`);
  
  const q = query(
    collection(db, `rooms/${roomId}/messages`),
    orderBy('timestamp', 'asc')
    // where("timestamp", ">=", Timestamp.fromMillis(listenStartMs - 60000)) // Optional: only load recent messages
  );
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const newMessages: ChatMessage[] = [];
    snapshot.docChanges().forEach((change) => {
        if (change.type === "added") { // Only process newly added messages
            const data = change.doc.data();
            const timestampFromServer = data.timestamp as Timestamp;
              newMessages.push({
                  id: change.doc.id,
                  ...data,
                  timestamp: timestampFromServer?.toDate() || new Date(), // Handle potential null or ensure it's a Date
              } as ChatMessage); // Type assertion
        }
    });

    if (newMessages.length > 0) {
      console.log(`[FirestoreService][${Timestamp.now().toMillis()}] listenForMessages: ${newMessages.length} new messages received for room ${roomId}`);
      callback(newMessages, snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null);
    }
  }, (error) => {
    console.error(`[FirestoreService][${Timestamp.now().toMillis()}] Error listening for messages in room ${roomId}:`, error);
  });
}


// --- Reporting ---
export async function createReport(reportData: ReportData): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createReport called for user: ${reportData.reportedUserId} by ${reportData.reportingUserId} in room ${reportData.roomId}`);
  const reportsCollection = collection(db, 'reports');
  await addDoc(reportsCollection, {
    ...reportData,
    timestamp: serverTimestamp(),
  });
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Report successfully created.`);
}
    

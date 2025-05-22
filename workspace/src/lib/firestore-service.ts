
import { db } from './firebase';
import { 
  collection, addDoc, query, where, getDocs, doc, updateDoc, onSnapshot, 
  serverTimestamp, limit, orderBy, setDoc, getDoc, writeBatch, type QuerySnapshot, type DocumentData, type QueryDocumentSnapshot, Timestamp, startAfter, getCountFromServer 
} from 'firebase/firestore';
import type { ChatMessage, ReportData, UserStatusData, RoomData, SignalData, SignalPayload } from '@/types';

// --- User Status and Matching ---

export async function updateUserStatus(userId: string, status: UserStatusData['status'], keywords?: string[], roomId?: string | null): Promise<void> {
  const currentTimestamp = Timestamp.now();
  const normalizedKeywords = keywords?.map(k => k.trim().toLowerCase()).filter(Boolean);
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] updateUserStatus for ${userId.substring(0,5)}: status=${status}, roomId=${roomId === undefined ? 'not specified' : roomId}, normalizedKeywords=${normalizedKeywords?.join(',')}`);
  const userStatusRef = doc(db, 'userStatuses', userId);
  const data: Partial<UserStatusData> = {
    userId, 
    status,
    lastSeen: serverTimestamp(), 
  };
  if (normalizedKeywords !== undefined) data.keywords = normalizedKeywords;
  if (roomId !== undefined) data.roomId = roomId; 

  try {
    await setDoc(userStatusRef, data, { merge: true });
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] User status successfully updated for ${userId.substring(0,5)} to ${status}.`);
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error updating user status for ${userId.substring(0,5)}:`, error);
    throw error;
  }
}


export async function findMatch(currentUserId: string, searchKeywords?: string[]): Promise<UserStatusData | null> {
  const currentTimestamp = Timestamp.now();
  let q;
  const usersRef = collection(db, "userStatuses");
  const fiveMinutesAgo = Timestamp.fromDate(new Date(Date.now() - 5 * 60 * 1000));
  let queryString = ""; 

  const normalizedSearchKeywords = searchKeywords?.map(k => k.trim().toLowerCase()).filter(Boolean);
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch called for ${currentUserId.substring(0,5)} with normalized keywords: [${(normalizedSearchKeywords || []).join(',')}]`);


  if (normalizedSearchKeywords && normalizedSearchKeywords.length > 0) {
    const effectiveKeywords = normalizedSearchKeywords.slice(0,10); // Firestore limit for array-contains-any
    queryString = `status == searching, userId != ${currentUserId.substring(0,5)}, keywords array-contains-any [${effectiveKeywords.join(', ')}], lastSeen > 5minAgo, orderBy lastSeen asc, limit 1`;
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId.substring(0,5)}: Querying WITH normalized keywords: [${effectiveKeywords.join(', ')}]`);
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
    queryString = `status == searching, userId != ${currentUserId.substring(0,5)}, lastSeen > 5minAgo, orderBy lastSeen asc, limit 1`;
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId.substring(0,5)}: Querying WITHOUT keywords.`);
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
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] findMatch for ${currentUserId.substring(0,5)}: Query executed: "${queryString}". Snapshot empty: ${querySnapshot.empty}. Docs found: ${querySnapshot.size}`);
    if (!querySnapshot.empty) {
      const matchedDoc = querySnapshot.docs[0]; 
      const matchedData = { userId: matchedDoc.id, ...matchedDoc.data() } as UserStatusData;
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Match found for ${currentUserId.substring(0,5)}: UserID='${matchedDoc.id.substring(0,5)}', Keywords='${JSON.stringify(matchedData.keywords)}', Status='${matchedData.status}'`);
      return matchedData;
    }
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] No match found via query for ${currentUserId.substring(0,5)}. Query: "${queryString}"`);
    return null;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error in findMatch for ${currentUserId.substring(0,5)} with query "${queryString}":`, error);
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
    // console.log(`[FirestoreService] Active user count: ${snapshot.data().count}`);
    return snapshot.data().count;
  } catch (error) {
    console.error("[FirestoreService] Error fetching active user count:", error);
    return 0; 
  }
}

// --- Room Management ---
export async function createRoom(userId1: string, userId2: string, keywordsUsed?: string[]): Promise<string> {
  const currentTimestamp = Timestamp.now();
  const normalizedKeywordsUsed = keywordsUsed?.map(k => k.trim().toLowerCase()).filter(Boolean) || [];
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createRoom called for users: ${userId1.substring(0,5)}, ${userId2.substring(0,5)} with normalized keywords: [${normalizedKeywordsUsed.join(',')}]`);
  
  const roomsCollection = collection(db, 'rooms');
  const roomDocRef = doc(roomsCollection); 

  const roomData: RoomData = {
    id: roomDocRef.id,
    users: [userId1, userId2],
    keywords: normalizedKeywordsUsed,
    createdAt: serverTimestamp(),
    status: 'active', 
  };
  
  const batch = writeBatch(db);
  batch.set(roomDocRef, roomData);
  
  const user1StatusRef = doc(db, 'userStatuses', userId1);
  const user1UpdateData = { status: 'chatting', roomId: roomDocRef.id, keywords: [] as string[] }; 
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createRoom: Queuing update for user ${userId1.substring(0,5)}:`, JSON.stringify(user1UpdateData));
  batch.update(user1StatusRef, user1UpdateData);

  const user2StatusRef = doc(db, 'userStatuses', userId2);
  const user2UpdateData = { status: 'chatting', roomId: roomDocRef.id, keywords: [] as string[] }; 
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createRoom: Queuing update for user ${userId2.substring(0,5)}:`, JSON.stringify(user2UpdateData));
  batch.update(user2StatusRef, user2UpdateData);
  
  try {
    await batch.commit();
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Room ${roomDocRef.id} created and user statuses (for ${userId1.substring(0,5)}, ${userId2.substring(0,5)}) updated to 'chatting'.`);
    return roomDocRef.id;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error committing batch for createRoom:`, error);
    throw error; 
  }
}

export async function getRoomData(roomId: string): Promise<RoomData | null> {
  const currentTimestamp = Timestamp.now();
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] getRoomData called for roomId: ${roomId}`);
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (roomSnap.exists()) {
    const data = { id: roomSnap.id, ...roomSnap.data() } as RoomData;
    // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Room data found for ${roomId}:`, data);
    return data;
  }
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] No room data found for ${roomId}`);
  return null;
}

export async function cleanupRoom(roomId: string, currentUserId: string): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom called for roomId: ${roomId} by user: ${currentUserId.substring(0,5)}`);
  const roomRef = doc(db, 'rooms', roomId);
  const batch = writeBatch(db);

  try {
    const roomData = await getRoomData(roomId); 
    if (roomData && roomData.status !== 'closed') { 
      roomData.users.forEach(userId => {
        const userStatusRef = doc(db, 'userStatuses', userId);
        batch.update(userStatusRef, { status: 'idle', roomId: null, keywords: [] });
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for ${userId.substring(0,5)} to idle (from room ${roomId}).`);
      });
      batch.update(roomRef, { status: 'closed', endedAt: serverTimestamp() });
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Queued update for room ${roomId} to closed.`);
    } else if (roomData && roomData.status === 'closed') {
      console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Room ${roomId} is already closed. Ensuring initiating user ${currentUserId.substring(0,5)} is idle if associated with this room.`);
       const currentUserStatusRef = doc(db, 'userStatuses', currentUserId);
       const currentUserStatusSnap = await getDoc(currentUserStatusRef);
       if(currentUserStatusSnap.exists() && currentUserStatusSnap.data().roomId === roomId) { 
           batch.update(currentUserStatusRef, { status: 'idle', roomId: null, keywords: [] });
       }
    } else {
        console.log(`[FirestoreService][${currentTimestamp.toMillis()}] cleanupRoom: Room ${roomId} not found or no action needed for its current status. Ensuring initiating user ${currentUserId.substring(0,5)} is idle if not already.`);
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
    await updateUserStatus(currentUserId, 'idle', [], null).catch(err => console.error("[FirestoreService] Fallback user status update failed during cleanupRoom error:", err));
  }
}


// --- WebRTC Signaling ---
export async function sendSignal(roomId: string, senderId: string, receiverId: string, signal: SignalPayload): Promise<void> {
  const currentTimestamp = Timestamp.now();
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] sendSignal from ${senderId.substring(0,5)} to ${receiverId.substring(0,5)} in room ${roomId}: type=${signal.type}`);
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  const signalDataToSend: SignalData = {
    senderId,
    receiverId,
    signal, 
    timestamp: serverTimestamp(),
  };
  await addDoc(signalsCollection, signalDataToSend);
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Signal type ${signal.type} sent successfully from ${senderId.substring(0,5)} to ${receiverId.substring(0,5)} in room ${roomId}.`);
}


export function listenForSignals(roomId: string, currentUserId: string, callback: (signalPayload: SignalPayload) => void): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  // console.log(`[FirestoreService][${listenStartMs}] listenForSignals setup for user ${currentUserId.substring(0,5)} in room ${roomId}, listening for signals where receiverId is ${currentUserId}`);
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  
  const q = query(
    signalsCollection, 
    where("receiverId", "==", currentUserId),
    where("timestamp", ">", Timestamp.fromMillis(listenStartMs - 10000)), 
    orderBy("timestamp", "asc") 
  );
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data() as SignalData;
        // console.log(`[FirestoreService][${Timestamp.now().toMillis()}] Received signal for ${currentUserId.substring(0,5)} in room ${roomId}: type=${data.signal.type}, sender=${data.senderId.substring(0,5)}, docId=${change.doc.id}`);
        callback(data.signal);
      }
    });
  }, (error) => {
    console.error(`[FirestoreService][${Timestamp.now().toMillis()}] Error listening for signals in room ${roomId} for user ${currentUserId.substring(0,5)}:`, error);
  });
  return unsubscribe;
}


// --- Chat Messages ---
export async function sendMessage(roomId: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> & { timestamp?: any }): Promise<string> {
  const currentTimestamp = Timestamp.now();
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] sendMessage to room ${roomId}: "${message.text.substring(0, 30)}${message.text.length > 30 ? '...' : ''}" by user ${message.userId.substring(0,5)}`);
  const messagesCollection = collection(db, `rooms/${roomId}/messages`);
  const docRef = await addDoc(messagesCollection, {
    ...message,
    timestamp: serverTimestamp(),
  });
  // console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Message sent to room ${roomId}, new message ID: ${docRef.id}`);
  return docRef.id;
}

export function listenForMessages(
  roomId: string,
  callback: (messages: ChatMessage[], newLastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null) => void,
  _lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null, 
  _pageSize: number = 50 
): () => void {
  const listenStartMs = Timestamp.now().toMillis();
  // console.log(`[FirestoreService][${listenStartMs}] listenForMessages setup for room ${roomId}`);
  
  const q = query(
    collection(db, `rooms/${roomId}/messages`),
    orderBy('timestamp', 'asc')
  );
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const newMessages: ChatMessage[] = [];
    snapshot.docChanges().forEach((change) => {
        if (change.type === "added") { 
            const data = change.doc.data();
            const timestampFromServer = data.timestamp as Timestamp;
              newMessages.push({
                  id: change.doc.id,
                  ...data,
                  timestamp: timestampFromServer?.toDate() || new Date(), 
              } as ChatMessage); 
        }
    });

    if (newMessages.length > 0) {
      // console.log(`[FirestoreService][${Timestamp.now().toMillis()}] listenForMessages: ${newMessages.length} new messages received for room ${roomId}`);
      callback(newMessages, snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null);
    }
  }, (error) => {
    console.error(`[FirestoreService][${Timestamp.now().toMillis()}] Error listening for messages in room ${roomId}:`, error);
  });
}


// --- Reporting ---
export async function createReport(reportData: ReportData): Promise<void> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] createReport called for user: ${reportData.reportedUserId.substring(0,5)} by ${reportData.reportingUserId.substring(0,5)} in room ${reportData.roomId}`);
  const reportsCollection = collection(db, 'reports');
  await addDoc(reportsCollection, {
    ...reportData,
    timestamp: serverTimestamp(),
  });
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Report successfully created.`);
}

export async function getReports(): Promise<ReportData[]> {
  const currentTimestamp = Timestamp.now();
  console.log(`[FirestoreService][${currentTimestamp.toMillis()}] getReports called.`);
  const reportsCollectionRef = collection(db, 'reports');
  const q = query(reportsCollectionRef, orderBy('timestamp', 'desc'));
  
  try {
    const querySnapshot = await getDocs(q);
    const reports: ReportData[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const timestamp = data.timestamp as Timestamp; // Firestore Timestamp
      reports.push({
        id: doc.id,
        reportedUserId: data.reportedUserId,
        reportingUserId: data.reportingUserId,
        reason: data.reason,
        roomId: data.roomId,
        timestamp: timestamp, // Keep original Firestore Timestamp if needed
        timestampDate: timestamp ? timestamp.toDate() : new Date(), // Convert to JS Date for display
      } as ReportData); // Type assertion
    });
    console.log(`[FirestoreService][${currentTimestamp.toMillis()}] Successfully fetched ${reports.length} reports.`);
    return reports;
  } catch (error) {
    console.error(`[FirestoreService][${currentTimestamp.toMillis()}] Error fetching reports:`, error);
    throw error; // Re-throw the error to be handled by the caller
  }
}
    

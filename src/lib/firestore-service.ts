
import { db } from './firebase';
import { 
  collection, addDoc, query, where, getDocs, doc, updateDoc, onSnapshot, 
  serverTimestamp, limit, orderBy, setDoc, getDoc, writeBatch, QuerySnapshot, DocumentData, QueryDocumentSnapshot 
} from 'firebase/firestore';
import type { ChatMessage, ReportData, UserStatusData, RoomData, SignalData } from '@/types';

// --- User Status and Matching ---

export async function updateUserStatus(userId: string, status: UserStatusData['status'], keywords?: string[], roomId?: string | null): Promise<void> {
  const userStatusRef = doc(db, 'userStatuses', userId);
  const data: UserStatusData = {
    userId,
    status,
    lastSeen: serverTimestamp(),
  };
  if (keywords !== undefined) data.keywords = keywords;
  if (roomId !== undefined) data.roomId = roomId; // Allow explicitly setting to null

  await setDoc(userStatusRef, data, { merge: true });
}

export async function findMatch(currentUserId: string, searchKeywords?: string[]): Promise<UserStatusData | null> {
  let q;
  const usersRef = collection(db, "userStatuses");

  if (searchKeywords && searchKeywords.length > 0) {
    // Firestore's array-contains-any is limited to 10, and OR queries are complex.
    // For simplicity, we'll try with the first keyword. A more robust solution would involve
    // fetching more users and filtering client-side, or using a dedicated search service.
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId),
      where("keywords", "array-contains-any", searchKeywords.slice(0,10)), // Use up to 10 keywords for query
      orderBy("lastSeen", "asc"),
      limit(10) // Fetch a few and pick the best one or first one client side
    );
  } else {
    // No keywords provided, find any searching user
    q = query(
      usersRef,
      where("status", "==", "searching"),
      where("userId", "!=", currentUserId),
      orderBy("lastSeen", "asc"),
      limit(1)
    );
  }

  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    // If keywords were used, we might need further client-side filtering if array-contains-any wasn't specific enough
    // For now, let's return the first potential match.
    return querySnapshot.docs[0].data() as UserStatusData;
  }
  return null;
}

export function listenToUserStatus(userId: string, callback: (status: UserStatusData | null) => void): () => void {
  const userStatusRef = doc(db, 'userStatuses', userId);
  return onSnapshot(userStatusRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data() as UserStatusData);
    } else {
      callback(null);
    }
  });
}


// --- Room Management ---
export async function createRoom(userId1: string, userId2: string, keywordsUsed?: string[]): Promise<string> {
  const roomsCollection = collection(db, 'rooms');
  const roomDocRef = doc(roomsCollection); // Generate new ID

  const roomData: RoomData = {
    id: roomDocRef.id,
    users: [userId1, userId2],
    keywords: keywordsUsed || [],
    createdAt: serverTimestamp(),
    status: 'pending', // Or 'signaling'
  };
  
  const batch = writeBatch(db);
  batch.set(roomDocRef, roomData);
  
  // Update status for userId1
  const user1StatusRef = doc(db, 'userStatuses', userId1);
  batch.update(user1StatusRef, { status: 'chatting', roomId: roomDocRef.id });

  // Update status for userId2
  const user2StatusRef = doc(db, 'userStatuses', userId2);
  batch.update(user2StatusRef, { status: 'chatting', roomId: roomDocRef.id });
  
  await batch.commit();
  return roomDocRef.id;
}

export async function getRoomData(roomId: string): Promise<RoomData | null> {
  const roomRef = doc(db, 'rooms', roomId);
  const roomSnap = await getDoc(roomRef);
  if (roomSnap.exists()) {
    return { id: roomSnap.id, ...roomSnap.data() } as RoomData;
  }
  return null;
}

export async function cleanupRoom(roomId: string): Promise<void> {
  const roomRef = doc(db, 'rooms', roomId);
  const batch = writeBatch(db);

  try {
    const roomData = await getRoomData(roomId);
    if (roomData && roomData.users) {
      roomData.users.forEach(userId => {
        const userStatusRef = doc(db, 'userStatuses', userId);
        batch.update(userStatusRef, { status: 'idle', roomId: null });
      });
    }
    batch.update(roomRef, { status: 'closed', endedAt: serverTimestamp() });
    await batch.commit();
  } catch (error) {
    console.error("Error cleaning up room:", error);
    // Fallback to just updating room status if user updates fail
    await updateDoc(roomRef, { status: 'closed', endedAt: serverTimestamp() }).catch(err => console.error("Fallback room cleanup failed:", err));
  }
}

// --- WebRTC Signaling ---
export async function sendSignal(roomId: string, senderId: string, receiverId: string, signal: SignalData['signal']): Promise<void> {
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  const signalDataToSend: SignalData = {
    senderId,
    receiverId,
    signal,
    timestamp: serverTimestamp(),
  };
  await addDoc(signalsCollection, signalDataToSend);
}

export function listenForSignals(roomId: string, currentUserId: string, callback: (signal: SignalData['signal']) => void): () => void {
  const signalsCollection = collection(db, `rooms/${roomId}/signals`);
  const q = query(
    signalsCollection, 
    where("receiverId", "==", currentUserId), 
    orderBy("timestamp", "asc")
  );
  
  let initialLoadDone = false;
  let lastProcessedTimestamp: any = null; // Store the timestamp of the last processed signal

  const unsubscribe = onSnapshot(q, (snapshot) => {
    if (!initialLoadDone) {
        // On initial load, find the latest signal to avoid processing old ones if any
        if (snapshot.docs.length > 0) {
            lastProcessedTimestamp = snapshot.docs[snapshot.docs.length - 1].data().timestamp;
        }
        initialLoadDone = true;
        return; // Skip initial documents to avoid re-processing old signals on reconnect
    }

    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data() as SignalData;
        // Check if this signal is newer than the last processed one
        if (!lastProcessedTimestamp || (data.timestamp && data.timestamp > lastProcessedTimestamp)) {
          callback(data.signal);
          lastProcessedTimestamp = data.timestamp;
        }
      }
    });
  });
  return unsubscribe;
}


// --- Chat Messages ---
export async function sendMessage(roomId: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> & { timestamp?: any }): Promise<string> {
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
  lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize: number = 20
): () => void {
  let q = query(
    collection(db, `rooms/${roomId}/messages`),
    orderBy('timestamp', 'asc') // Fetch oldest first to easily append to existing messages
  );

  if (lastVisibleDoc) {
    q = query(q, orderBy('timestamp', 'asc'), limit(pageSize), startAfter(lastVisibleDoc));
  } else {
    q = query(q, orderBy('timestamp', 'desc'), limit(pageSize)); // Get latest N messages on initial load
  }
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    let newMessages: ChatMessage[];
    let newLastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

    if (!lastVisibleDoc && snapshot.docs.length > 0) { // Initial load (latest N)
        newMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(),
      } as ChatMessage)).reverse(); // Reverse to show newest at bottom
      newLastDoc = snapshot.docs[0]; // The oldest of the latest N for next "load older" if using desc
                                     // Actually, if we want infinite scroll up, this needs more thought.
                                     // For now, simple latest N.
    } else { // Subsequent loads (older messages)
        newMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate() || new Date(),
      } as ChatMessage));
      newLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : lastVisibleDoc;
    }
    
    callback(newMessages, newLastDoc);
  }, (error) => {
    console.error("Error listening for messages:", error);
  });
}

// --- Reporting ---
export async function createReport(reportData: ReportData): Promise<void> {
  const reportsCollection = collection(db, 'reports');
  await addDoc(reportsCollection, {
    ...reportData,
    timestamp: serverTimestamp(),
  });
}
    
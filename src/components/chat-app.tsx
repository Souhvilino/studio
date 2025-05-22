
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { VideoArea } from './video-area';
import { MessageItem } from './message-item';
import { ReportDialog } from './report-dialog';
import { useFirebaseAuth } from './firebase-auth-provider';
import type { ChatMessage, ChatState, ReportData, UserStatusData } from '@/types';
import { Send, Loader2, MessageSquare, Search, XCircle, RotateCcw, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { moderateText, type ModerateTextInput } from '@/ai/flows/ai-moderation';
import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation';
import * as FirestoreService from '@/lib/firestore-service';
import { useWebRTCSignaling } from '@/hooks/use-webrtc-signaling';
import { db } from '@/lib/firebase'; 
import { onSnapshot, doc } from 'firebase/firestore'; 


export default function ChatApp() {
  const { user: firebaseUser } = useFirebaseAuth();
  const { toast } = useToast();

  const [keywordsInput, setKeywordsInput] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatState>('idle');
  
  const [roomId, setRoomId] = useState<string | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [activeUserCount, setActiveUserCount] = useState<number | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatStateRef = useRef(chatState);
  const roomIdRef = useRef(roomId);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isStoppingChatRef = useRef(false);


  useEffect(() => {
    chatStateRef.current = chatState;
    // console.log(`[${firebaseUser?.uid?.substring(0,5)}] chatState UPDATED to: ${chatState}`);
  }, [chatState]);

  useEffect(() => {
    roomIdRef.current = roomId;
    // console.log(`[${firebaseUser?.uid?.substring(0,5)}] roomId UPDATED to: ${roomId}`);
  }, [roomId]);

  const stableToast = useCallback(toast, []); 

  // Memoized callbacks
  const onLocalStreamCallback = useCallback((stream: MediaStream | null) => {
    setLocalStream(stream);
  }, []);

  const onRemoteStreamCallback = useCallback((stream: MediaStream | null) => {
    setRemoteStream(stream);
  }, []);


  const handleStopChatReal = useCallback(async (initiateNewSearch = false) => {
    const currentUid = firebaseUser?.uid || 'unknownUser';
    console.log(`[${currentUid}] handleStopChatReal CALLED. isStoppingChatRef.current: ${isStoppingChatRef.current}, chatStateRef.current: ${chatStateRef.current}, initiateNewSearch: ${initiateNewSearch}`);

    if (isStoppingChatRef.current) {
      console.log(`[${currentUid}] handleStopChatReal: Already in progress of stopping. Returning early.`);
      return;
    }
    isStoppingChatRef.current = true;
    console.log(`[${currentUid}] handleStopChatReal: SET isStoppingChatRef.current = true.`);
    
    try {
      if (searchTimeoutRef.current) {
        console.log(`[${currentUid}] handleStopChatReal: Clearing search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      const previousRoomId = roomIdRef.current; 
      const previousChatState = chatStateRef.current;

      setChatState('idle'); 
      setRoomId(null); 
      setRemoteUserId(null);
      setMessages([]);
      setIsCaller(false); 
      
      // stableWebrtcCleanup will be called via the hook's cleanup effect or explicit call
      // For now, let's ensure webrtcCleanup is called directly here if needed.
      // This might be redundant if useWebRTCSignaling's cleanup is robust.
      console.log(`[${currentUid}] handleStopChatReal: Local states reset. Calling webrtcCleanup directly.`);
      webrtcCleanup();


      if (firebaseUser) {
        console.log(`[${currentUid}] handleStopChatReal: Current user ID: ${firebaseUser.uid}. Previous Room ID: ${previousRoomId}, Previous Chat State: ${previousChatState}`);
        if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          console.log(`[${currentUid}] handleStopChatReal: Cleaning up room in Firestore: ${previousRoomId}`);
          await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid); 
        } else if (previousChatState === 'searching') { 
          console.log(`[${currentUid}] handleStopChatReal: Was searching. Updating Firestore status to 'idle'.`);
          await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
        } else {
          console.log(`[${currentUid}] handleStopChatReal: No room ID to clean, or not in a relevant chat state (${previousChatState}). Ensuring user status is idle if not already.`);
           if (previousChatState !== 'idle') { 
              await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
           }
        }
      } else {
          console.warn(`[${currentUid}] handleStopChatReal: Firebase user not available, cannot update Firestore status.`);
      }

      if (initiateNewSearch && firebaseUser) { 
        console.log(`[${currentUid}] handleStopChatReal: Initiating new search after stopping chat (via handleStartSearchRef).`);
        handleStartSearchRef.current(); // Call the ref to the latest start search function
      } else if (!initiateNewSearch && (previousChatState === 'chatting' || previousChatState === 'connecting')) { 
          stableToast({ title: "Chat Ended", description: "The chat session has been closed." });
      }
    } catch (error) {
        console.error(`[${currentUid}] Error during handleStopChatReal's main try block:`, error);
    } finally {
        console.log(`[${currentUid}] handleStopChatReal: FINALLY block. Setting isStoppingChatRef.current = false.`);
        isStoppingChatRef.current = false;
    }
  }, [firebaseUser, stableToast, /* webrtcCleanup directly from hook now */]); // Removed stableWebrtcCleanup as we call webrtcCleanup directly


  const { 
    startCall: webrtcStartCall, 
    cleanup: webrtcCleanup, // Direct ref to cleanup
    setupLocalStream: webrtcSetupLocalStreamOriginal, 
    peerConnection,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: onLocalStreamCallback, 
    onRemoteStream: onRemoteStreamCallback,
    onConnectionStateChange: useCallback((state) => { // useCallback for stable onConnectionStateChange
      const currentUid = firebaseUser?.uid || 'unknownUser';
      console.log(`[${currentUid}] WebRTC Connection State: ${state}, isStoppingChatRef.current: ${isStoppingChatRef.current}, current chatStateRef: ${chatStateRef.current}`);
      
      if (isStoppingChatRef.current && (state === 'failed' || state === 'disconnected' || state === 'closed')) {
        console.log(`[${currentUid}] onConnectionStateChange: Chat is already stopping, ignoring further cleanup trigger from WebRTC state ${state}.`);
        return;
      }

      if (state === 'connected') {
        setChatState('chatting');
        stableToast({ title: "Connected!", description: "You are now chatting with a partner." });
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (chatStateRef.current !== 'idle' && chatStateRef.current !== 'searching') { 
          console.log(`[${currentUid}] onConnectionStateChange: Connection lost/closed (state: ${state}), chatStateRef was ${chatStateRef.current}. Triggering handleStopChatReal.`);
          if (state !== 'closed' && chatStateRef.current !== 'idle') { 
            stableToast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          }
          handleStopChatRef.current(false); 
        } else {
           console.log(`[${currentUid}] onConnectionStateChange: Connection lost/closed (state: ${state}), but chatStateRef is ${chatStateRef.current}. Not calling handleStopChatReal from here.`);
        }
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firebaseUser?.uid, stableToast /* handleStopChatRef is stable via useRef */]),
  });
  const peerConnectionRef = peerConnection; 

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (roomId && chatState === 'chatting' && firebaseUser?.uid) {
      const unsubscribe = FirestoreService.listenForMessages(roomId, (newMessages) => {
        setMessages(prevMessages => {
          const existingMessageIds = new Set(prevMessages.map(m => m.id));
          const uniqueNewMessages = newMessages.filter(nm => !existingMessageIds.has(nm.id));
          
          return [...prevMessages, ...uniqueNewMessages]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(msg => ({...msg, isLocalUser: msg.userId === firebaseUser.uid }));
        });
      });
      return () => unsubscribe();
    }
  }, [roomId, chatState, firebaseUser?.uid]);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const count = await FirestoreService.getActiveUserCount();
        setActiveUserCount(count);
      } catch (error) {
        console.error("Failed to fetch active user count:", error);
        setActiveUserCount(null);
      }
    };

    fetchCount(); 
    const intervalId = setInterval(fetchCount, 30000); 

    return () => clearInterval(intervalId); 
  }, []);

  const handleStartSearchReal = useCallback(async () => {
    const currentUid = firebaseUser?.uid;
    if (!currentUid) {
      stableToast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
      return;
    }
    console.log(`[${currentUid}] handleStartSearchReal called with raw keywordsInput: "${keywordsInput}"`);

    if (isStoppingChatRef.current) {
      console.log(`[${currentUid}] handleStartSearchReal: Currently stopping a chat, search aborted.`);
      return;
    }

    if (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting') {
        console.log(`[${currentUid}] handleStartSearchReal: Already in state ${chatStateRef.current}. Stopping current chat first before searching.`);
        await handleStopChatRef.current(false); 
    }
    
    if (searchTimeoutRef.current) {
        console.log(`[${currentUid}] handleStartSearchReal: Clearing previous search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
    }

    setChatState('searching'); 
    stableToast({ title: "Searching...", description: "Looking for a chat partner." });
    
    const searchKeywords = keywordsInput.split(',')
      .map(k => k.trim().toLowerCase()) 
      .filter(Boolean);
    console.log(`[${currentUid}] handleStartSearchReal: Normalized searchKeywords: [${searchKeywords.join(',')}]`);
    
    let matchedUser: UserStatusData | null = null;

    try {
      if (searchKeywords.length > 0) {
          console.log(`[${currentUid}] handleStartSearchReal: Attempting match WITH normalized keywords:`, searchKeywords);
          matchedUser = await FirestoreService.findMatch(currentUid, searchKeywords);
          console.log(`[${currentUid}] handleStartSearchReal: findMatch (with keywords) result:`, matchedUser ? `${matchedUser.userId} - Keywords: ${matchedUser.keywords?.join(',')}` : 'null');
      }

      if (!matchedUser) {
          console.log(searchKeywords.length > 0 ? `[${currentUid}] handleStartSearchReal: No match with keywords, trying to find any searching user.` : `[${currentUid}] handleStartSearchReal: No keywords provided, trying to find any searching user.`);
          matchedUser = await FirestoreService.findMatch(currentUid, []); // Pass empty array for general search
          console.log(`[${currentUid}] handleStartSearchReal: findMatch (general) result:`, matchedUser ? `${matchedUser.userId} - Keywords: ${matchedUser.keywords?.join(',')}` : 'null');
      }
      
      if (matchedUser && matchedUser.userId !== currentUid) { 
        console.log(`[${currentUid}] handleStartSearchReal: Match found: ${matchedUser.userId}, their normalized keywords:`, matchedUser.keywords?.map(k=>k.toLowerCase()));
        setRemoteUserId(matchedUser.userId);
        
        const combinedKeywords = Array.from(new Set([
            ...searchKeywords, 
            ...(matchedUser.keywords?.map(k => k.toLowerCase()) || [])
        ]));
        console.log(`[${currentUid}] handleStartSearchReal: Calling createRoom with self=${currentUid}, partner=${matchedUser.userId}, combined normalized keywords: [${combinedKeywords.join(',')}]`);
        const assignedRoomId = await FirestoreService.createRoom(currentUid, matchedUser.userId, combinedKeywords);
        console.log(`[${currentUid}] handleStartSearchReal: Room created: ${assignedRoomId}. This user (CALLER) sets state to connecting.`);
        setRoomId(assignedRoomId); 
        setIsCaller(true);
        setChatState('connecting'); 
        console.log(`[${currentUid}] handleStartSearchReal: CALLER state 'connecting'. Setting up local stream.`);
        await webrtcSetupLocalStreamHookRef.current(); 
      } else { 
        console.log(`[${currentUid}] handleStartSearchReal: No immediate match. Updating self to 'searching'. Normalized Keywords: [${searchKeywords.join(',')}]`);
        await FirestoreService.updateUserStatus(currentUid, 'searching', searchKeywords, null); 

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); 
        searchTimeoutRef.current = setTimeout(async () => {
          const uidForTimeout = firebaseUser?.uid || 'unknownInTimeout';
          console.log(`[${uidForTimeout}] Search timeout initiated. Current refs at timeout: chatStateRef=${chatStateRef.current}, roomIdRef=${roomIdRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser?.uid) { 
            console.log(`[${uidForTimeout}] Search timeout! No match found for user: ${uidForTimeout}. Current chatState: ${chatStateRef.current}`);
            stableToast({ title: "No match found", description: "Try broadening your keywords or try again later."});
             await handleStopChatRef.current(false); 
          } else {
            console.log(`[${uidForTimeout}] Search timeout condition not met or already resolved. chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          }
          searchTimeoutRef.current = null;
        }, 30000); 
        console.log(`[${currentUid}] handleStartSearchReal: Set search timeout ID: ${searchTimeoutRef.current}`);
      }
    } catch (error) {
      console.error(`[${currentUid}] Error in handleStartSearchReal:`, error);
      stableToast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      if (chatStateRef.current !== 'idle') {
        setChatState('idle');
        if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }
  }, [firebaseUser, keywordsInput, stableToast, webrtcSetupLocalStreamOriginal]); // webrtcSetupLocalStreamOriginal is from the hook

  // Refs for callbacks
  const handleStartSearchRef = useRef(handleStartSearchReal);
  const handleStopChatRef = useRef(handleStopChatReal);
  const webrtcSetupLocalStreamHookRef = useRef(webrtcSetupLocalStreamOriginal);

  useEffect(() => {
    handleStartSearchRef.current = handleStartSearchReal;
  }, [handleStartSearchReal]);

  useEffect(() => {
    handleStopChatRef.current = handleStopChatReal;
  }, [handleStopChatReal]);

  useEffect(() => {
    webrtcSetupLocalStreamHookRef.current = webrtcSetupLocalStreamOriginal;
  }, [webrtcSetupLocalStreamOriginal]);
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      const currentUid = firebaseUser.uid;
      console.log(`[${currentUid}] Attempting to start WebRTC call. Room: ${roomId}, Is Caller: ${isCaller}, Signaling State: ${peerConnectionRef.current?.signalingState}, localStream tracks: ${localStream?.getTracks().length}`);
      if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === 'closed') {
         console.log(`[${currentUid}] Creating new PeerConnection and starting call (isCaller: ${isCaller}).`);
         webrtcStartCall(isCaller); 
      } else if (peerConnectionRef.current.signalingState === 'stable' || peerConnectionRef.current.signalingState === 'have-local-offer' || peerConnectionRef.current.signalingState === 'have-remote-offer') {
        console.log(`[${currentUid}] PC exists (state: ${peerConnectionRef.current.signalingState}), re-initiating call process (isCaller: ${isCaller}).`);
        webrtcStartCall(isCaller); 
      } else {
        console.log(`[${currentUid}] PC exists but not in a state to start/restart call, current state: ${peerConnectionRef.current.signalingState}. Waiting.`);
      }
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, webrtcStartCall, peerConnectionRef]);
  
  useEffect(() => {
    if (firebaseUser?.uid) {
      const currentUid = firebaseUser.uid;
      const userStatusDocRef = doc(db, 'userStatuses', currentUid);
      console.log(`[${currentUid}] Setting up onSnapshot listener for self (userStatuses/${currentUid}). Initial chatStateRef: ${chatStateRef.current}`);

      const unsubscribe = onSnapshot(userStatusDocRef, async (docSnap) => {
        const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
        
        console.log(`[${currentUid}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus), ` PendingWrites: ${docSnap.metadata.hasPendingWrites}`);
        console.log(`[${currentUid}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}, searchTimeoutRef active: ${searchTimeoutRef.current !== null}`);
        
        if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
          // CRITICAL: Clear search timeout as soon as 'chatting' status with a roomId is detected.
          if (searchTimeoutRef.current) {
            console.log(`[${currentUid}] STATUS LISTENER: User status is 'chatting' with roomId ${userStatus.roomId}. Clearing search timeout ID: ${searchTimeoutRef.current}.`);
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
          }

          const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;
          console.log(`[${currentUid}] STATUS LISTENER (processing 'chatting' status): isNewOrDifferentRoomForMe=${isNewOrDifferentRoomForMe}, client chatStateRef=${chatStateRef.current}, client roomIdRef=${roomIdRef.current}`);
          
          // CALLEE PATH or state correction if already in a room process but Firestore says otherwise
          if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) { 
            console.log(`[${currentUid}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Matched! Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
            
            setRoomId(userStatus.roomId); 
            setChatState('connecting'); 

            const roomData = await FirestoreService.getRoomData(userStatus.roomId);
            if (roomData && roomData.users) {
              const otherUser = roomData.users.find((uid: string) => uid !== currentUid);
              if (otherUser) {
                 setRemoteUserId(otherUser);
                 setIsCaller(false); 
                 console.log(`[${currentUid}] CALLEE PATH: User is callee (other user: ${otherUser}). Setting up local stream.`);
                 await webrtcSetupLocalStreamHookRef.current(); 
              } else {
                console.error(`[${currentUid}] ERROR (CALLEE PATH): Other user not found in roomData for room ${userStatus.roomId}. Users: ${JSON.stringify(roomData.users)}. My ID: ${currentUid}`);
                stableToast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
              }
            } else {
              console.error(`[${currentUid}] ERROR (CALLEE PATH): Room data not found for room ${userStatus.roomId} or users array missing.`);
              stableToast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
              if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
            }
          } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) { // CALLER PATH confirmation
             console.log(`[${currentUid}] STATUS LISTENER (CALLER PATH CONFIRMATION): Status 'chatting' for current room ${userStatus.roomId} while I am 'connecting'. Expected for caller.`);
             if (!localStream) { 
                console.log(`[${currentUid}] STATUS LISTENER (CALLER PATH): Local stream not yet available, setting it up.`);
                await webrtcSetupLocalStreamHookRef.current();
             }
          } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && (chatStateRef.current === 'connecting' || chatStateRef.current === 'chatting')) {
             // This means Firestore assigned us to a new room while we thought we were in another. Clean up old.
             console.warn(`[${currentUid}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while already in a process for room ${roomIdRef.current}. Forcing stop of old. Current state: ${chatStateRef.current}`);
             await handleStopChatRef.current(false); // Stop old chat
             // Then, re-process this new 'chatting' status in a moment (onSnapshot will fire again or re-evaluate)
             // For now, let the next onSnapshot handle the new room state after cleanup.
          } else if (roomIdRef.current === userStatus.roomId && chatStateRef.current === 'chatting') {
             // Already in the correct chatting state for this room.
             console.log(`[${currentUid}] STATUS LISTENER: Already in 'chatting' state for room ${userStatus.roomId}. No state change needed.`);
          } else {
             console.log(`[${currentUid}] STATUS LISTENER (chatting status): No specific action taken for this 'chatting' update. isNewOrDifferentRoom: ${isNewOrDifferentRoomForMe}, Client ChatState: ${chatStateRef.current}, Client RoomId: ${roomIdRef.current}, Firestore RoomId: ${userStatus.roomId}`);
          }

        } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
          // Firestore says we are idle, but client thinks it's in a room. This could happen if other user left.
          console.log(`[${currentUid}] STATUS LISTENER: My status in Firestore is 'idle', but client was in room ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
          if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) { 
             await handleStopChatRef.current(false); 
          }
        } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
            // Firestore says we are searching, but client thinks it's in a room.
            console.warn(`[${currentUid}] STATUS LISTENER: My status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
            if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
        } else {
          console.log(`[${currentUid}] STATUS LISTENER: No specific state-changing action taken for my status: ${userStatus?.status}, my Firestore roomId: ${userStatus?.roomId}. My client refs: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);
        }
      }, (error) => {
        console.error(`[${currentUid}] Error in my user status onSnapshot listener:`, error);
      });
      
      return () => {
        console.log(`[${currentUid}] Unsubscribing from my user status listener (userStatuses/${currentUid}).`);
        unsubscribe();
        if (searchTimeoutRef.current) { 
            console.log(`[${currentUid}] Clearing search timeout Ref ${searchTimeoutRef.current} during self-status listener cleanup.`);
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, stableToast]); 


  const handleSendMessage = async () => {
    if (!currentMessage.trim() || !firebaseUser || !roomId || chatState !== 'chatting') return;

    const moderationInput: ModerateTextInput = { text: currentMessage };
    try {
      const moderationResult = await moderateText(moderationInput);
      if (!moderationResult.isSafe) {
        stableToast({ title: "Message Moderated", description: `Your message was flagged: ${moderationResult.reason || 'Reason not provided'}. Not sent.`, variant: "destructive" });
        setCurrentMessage('');
        return;
      }
    } catch (error) {
      console.error("Moderation error:", error);
      stableToast({ title: "Moderation Error", description: "Could not moderate message. Please try again.", variant: "destructive" });
      return; 
    }

    const newMessagePayload: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> = {
      userId: firebaseUser.uid,
      text: currentMessage,
      originalText: currentMessage, 
    };
    
    try {
      await FirestoreService.sendMessage(roomId, newMessagePayload);
      setCurrentMessage('');
    } catch (error) {
      console.error("Error sending message:", error);
      stableToast({ title: "Send Error", description: "Could not send message.", variant: "destructive" });
    }
  };

  const handleTranslateMessage = async (messageId: string, textToTranslate: string, context: string): Promise<{ translatedText: string } | { error: string }> => {
    try {
      const targetLanguage = navigator.language.split('-')[0] || 'en'; 
      const translationInput: TranslateMessageInput = {
        text: textToTranslate,
        sourceLanguage: "auto", 
        targetLanguage: targetLanguage,
        context: context,
      };
      const result = await translateMessage(translationInput);
      
      setMessages(prevMessages => prevMessages.map(msg => 
        msg.id === messageId ? { ...msg, translatedText: result.translatedText, text: result.translatedText, isTranslating: false, translationError: undefined } : msg
      ));
      return { translatedText: result.translatedText };
    } catch (error) {
      console.error("Translation API error:", error);
      setMessages(prevMessages => prevMessages.map(msg => 
        msg.id === messageId ? { ...msg, translationError: "Failed to translate", isTranslating: false } : msg
      ));
      return { error: "Failed to translate." };
    }
  };
  
  const getConversationContext = (): string => {
    return messages.slice(-5).map(m => `${m.isLocalUser ? 'Me' : 'Partner'}: ${m.originalText || m.text}`).join('\n');
  }

  if (!firebaseUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }

  const isInteractionDisabled = chatState === 'searching' || chatState === 'connecting';
  const isChatActive = chatState === 'chatting' || chatState === 'connecting';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b border-border shadow-sm bg-card flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
        {activeUserCount !== null && (
          <Badge variant="secondary" className="text-sm">
            <Users className="mr-2 h-4 w-4" />
            {activeUserCount} Active Users
          </Badge>
        )}
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {(!isChatActive || chatState === 'idle') && ( 
           <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">Find a Chat Partner</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="text"
                placeholder="Enter keywords (e.g., travel, gaming), comma-separated"
                value={keywordsInput}
                onChange={(e) => setKeywordsInput(e.target.value)}
                className="mb-4"
                disabled={isInteractionDisabled}
              />
            </CardContent>
            <CardFooter>
               <Button onClick={handleStartSearchRef.current} disabled={isInteractionDisabled} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {chatState === 'searching' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                {chatState === 'searching' ? 'Searching...' : 'Start Chat'}
              </Button>
            </CardFooter>
          </Card>
        )}

        {(isChatActive || localStream || remoteStream ) && ( 
          <VideoArea localStream={localStream} remoteStream={remoteStream} isChatting={chatState === 'chatting'} />
        )}

        {isChatActive && ( 
          <Card className="flex-1 flex flex-col shadow-lg overflow-hidden">
            <CardHeader className="p-4 border-b">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg flex items-center">
                  <MessageSquare className="mr-2 h-5 w-5 text-primary" /> 
                  {chatState === 'connecting' ? 'Connecting...' : chatState === 'chatting' ? 'Chatting' : 'Chat Room'}
                </CardTitle>
                <div className="flex gap-2">
                   <Button onClick={() => handleStopChatRef.current(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10" disabled={chatState === 'searching' || chatState === 'idle'}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChatRef.current(false)} variant="destructive" size="sm" disabled={chatState === 'searching' || chatState === 'idle'}>
                    <XCircle className="mr-2 h-4 w-4" /> Stop Chat
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea className="h-full p-4">
                {messages.map((msg) => (
                  <MessageItem key={msg.id} message={msg} onTranslate={handleTranslateMessage} conversationContext={getConversationContext()} />
                ))}
                <div ref={messagesEndRef} />
                 {chatState === 'connecting' && messages.length === 0 && (
                    <div className="flex justify-center items-center h-full text-muted-foreground">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Establishing secure connection...
                    </div>
                )}
              </ScrollArea>
            </CardContent>
            <CardFooter className="p-4 border-t">
              <div className="flex w-full items-center gap-2">
                <Input
                  type="text"
                  placeholder="Type your message..."
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  disabled={chatState !== 'chatting'}
                  className="flex-1"
                />
                <Button onClick={handleSendMessage} disabled={chatState !== 'chatting' || !currentMessage.trim()} className="bg-primary hover:bg-primary/90">
                  <Send className="h-4 w-4" />
                </Button>
                 <ReportDialog 
                    reportedUserId={remoteUserId} 
                    reportingUserId={firebaseUser?.uid  || null} 
                    currentRoomId={roomId}
                    onSubmitReport={async (data) => FirestoreService.createReport(data)}
                    disabled={chatState !== 'chatting' || !remoteUserId}
                  />
              </div>
            </CardFooter>
          </Card>
        )}
        {chatState === 'idle' && !isChatActive && !localStream && !remoteStream && ( 
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <MessageSquare size={64} className="mb-4" />
                <h2 className="text-2xl font-semibold mb-2 text-foreground">Welcome to Chatter Anon!</h2>
                <p className="mb-4">Enter some keywords or just hit "Start Chat" to find a random chat partner.</p>
                <p className="text-sm">Your privacy is important. Chats are anonymous.</p>
            </div>
        )}
      </main>
    </div>
  );
}

    
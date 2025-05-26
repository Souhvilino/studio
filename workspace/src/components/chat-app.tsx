
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VideoArea } from './video-area';
import { MessageItem } from './message-item';
import { ReportDialog } from './report-dialog';
import { useFirebaseAuth } from './firebase-auth-provider';
import type { ChatMessage, ChatState as AppChatState, ReportData, UserStatusData, IpLocationData } from '@/types'; 
import { Send, Loader2, MessageSquare, XCircle, RotateCcw, Users, Info, MessageCircle, Video, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { moderateText, type ModerateTextInput } from '@/ai/flows/ai-moderation';
import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation';
import { getIpLocation, type GetIpLocationOutput } from '@/ai/flows/get-ip-location-flow';
import * as FirestoreService from '@/lib/firestore-service';
import { useWebRTCSignaling } from '@/hooks/use-webrtc-signaling';
import { db } from '@/lib/firebase'; // Direct import for onSnapshot
import { onSnapshot, doc } from 'firebase/firestore'; // Direct import for onSnapshot

type ChatMode = 'text' | 'video' | null;

export default function ChatApp() {
  const { user: firebaseUser } = useFirebaseAuth();
  const { toast } = useToast();

  const [keywordsInput, setKeywordsInput] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<AppChatState>('idle'); 
  const [chatMode, setChatMode] = useState<ChatMode>(null); 

  const [roomId, setRoomId] = useState<string | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  // const [activeUserCount, setActiveUserCount] = useState<number | null>(null); // Commented out due to quota issues
  const [partnerLocationDisplay, setPartnerLocationDisplay] = useState<string | null>(null);


  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatStateRef = useRef(chatState);
  const roomIdRef = useRef(roomId);
  const isStoppingChatRef = useRef(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const CUID_SHORT = firebaseUser?.uid.substring(0, 5) || 'anon';

  useEffect(() => {
    chatStateRef.current = chatState;
  }, [chatState]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const onLocalStreamCallback = useCallback((stream: MediaStream | null) => {
    // console.log(`[ChatApp ${CUID_SHORT}] onLocalStreamCallback. Stream ID: ${stream?.id}`);
    setLocalStream(stream);
  }, [CUID_SHORT]);

  const onRemoteStreamCallback = useCallback((stream: MediaStream | null) => {
    console.log(`[ChatApp ${CUID_SHORT}] onRemoteStreamCallback. Stream ID: ${stream?.id}`);
    setRemoteStream(stream);
  }, [CUID_SHORT]);
  
  const {
    startCall: webrtcStartCall,
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStream,
    peerConnection: peerConnectionRef,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: onLocalStreamCallback,
    onRemoteStream: onRemoteStreamCallback,
    onConnectionStateChange: useCallback((state) => {
      // console.log(`[ChatApp ${CUID_SHORT}] WebRTC Connection State: ${state}, isStoppingChatRef.current: ${isStoppingChatRef.current}, current chatStateRef: ${chatStateRef.current}`);
      if (isStoppingChatRef.current && (state === 'failed' || state === 'disconnected' || state === 'closed')) {
        // console.log(`[ChatApp ${CUID_SHORT}] onConnectionStateChange: Chat is already stopping, ignoring further cleanup from WebRTC state ${state}.`);
        return;
      }
      if (state === 'connected') {
        setChatState('chatting'); 
        toast({ title: "Connected!", description: "You are now chatting with a partner." });
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (!isStoppingChatRef.current && chatStateRef.current !== 'idle' && chatStateRef.current !== 'searching') {
          console.log(`[ChatApp ${CUID_SHORT}] onConnectionStateChange: Connection lost/closed (state: ${state}), chatState was ${chatStateRef.current}. Triggering handleStopChat.`);
          if (chatStateRef.current !== 'idle' && chatStateRef.current !== 'closed' ) {
            toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          }
          handleStopChatRef.current(false); // Use ref
        }
      }
    }, [CUID_SHORT, toast]), // handleStopChatRef is stable
  });

  const handleStopChatReal = useCallback(async (initiateNewSearch = false) => {
    console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal CALLED. isStopping: ${isStoppingChatRef.current}, current chatState: ${chatStateRef.current}, newSearch: ${initiateNewSearch}, currentRoomId: ${roomIdRef.current}`);
    
    if (isStoppingChatRef.current && !initiateNewSearch) {
        console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Already stopping and not initiating new search. Early exit.`);
        return;
    }
    isStoppingChatRef.current = true;

    const previousRoomId = roomIdRef.current;
    const previousChatState = chatStateRef.current;
    console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: prevRoomId=${previousRoomId}, prevChatState=${previousChatState}`);

    if (searchTimeoutRef.current) {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Clearing search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
    }

    setChatState('idle');
    setRoomId(null); // This will trigger the useEffect for useWebRTCSignaling's roomId dependency
    setRemoteUserId(null);
    setMessages([]);
    setIsCaller(false);
    setPartnerLocationDisplay(null); 
    if (!initiateNewSearch) {
        setChatMode(null); // Go back to main landing if not immediately searching again
    }

    // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Calling webrtcCleanup.`);
    webrtcCleanup(); // This is stable from the hook

    if (firebaseUser) {
      if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Firestore cleanup for user ${firebaseUser.uid} in room ${previousRoomId}.`);
          await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid);
      } else if (previousChatState === 'searching' && previousRoomId === null) { 
          // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Was searching (state: ${previousChatState}, no room), ensuring user status is idle for ${firebaseUser.uid}.`);
          await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }

    if (initiateNewSearch && firebaseUser && chatMode) {
      console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: Queuing new search with mode ${chatMode}.`);
      setTimeout(() => {
        if (isStoppingChatRef.current) { // Check again before starting new search
            handleStartSearchRef.current(chatMode); // Use ref
            isStoppingChatRef.current = false; 
            // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: New search initiated, isStoppingChatRef reset.`);
        }
      }, 100); 
    } else {
      if (!initiateNewSearch && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          toast({ title: "Chat Ended", description: "The chat session has been closed." });
      }
      isStoppingChatRef.current = false;
      // console.log(`[ChatApp ${CUID_SHORT}] handleStopChatReal: FINALLY. Setting isStoppingChatRef.current = false.`);
    }
  }, [CUID_SHORT, firebaseUser, toast, webrtcCleanup, chatMode]); // chatMode is state, ensure this callback updates if chatMode changes

  const handleStartSearchReal = useCallback(async (selectedChatMode: ChatMode) => {
    console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal called with raw keywordsInput: "${keywordsInput}", selectedChatMode: ${selectedChatMode}`);
    if (!selectedChatMode) {
        toast({ title: "Error", description: "Please select a chat mode.", variant: "destructive"});
        return;
    }
    setChatMode(selectedChatMode); 

    if (!firebaseUser) {
        toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
        return;
    }

    if (searchTimeoutRef.current) {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Clearing previous search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
    }
    
    if (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting') {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Already in state ${chatStateRef.current}. Stopping current chat first.`);
        await handleStopChatRef.current(false); 
    }

    setChatState('searching');
    toast({ title: "Searching...", description: "Looking for a chat partner." });

    const normalizedSearchKeywords = keywordsInput.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Normalized searchKeywords: [${normalizedSearchKeywords.join(',')}]`);

    let matchedUser: UserStatusData | null = null;
    try {
      if (normalizedSearchKeywords.length > 0) {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Attempting match WITH normalized keywords:`, normalizedSearchKeywords);
        matchedUser = await FirestoreService.findMatch(firebaseUser.uid, normalizedSearchKeywords);
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: findMatch (with keywords) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)}` : 'null');
      }
        
      if (!matchedUser) {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: No match with keywords (or no keywords provided), trying to find any searching user.`);
        matchedUser = await FirestoreService.findMatch(firebaseUser.uid, []); // General search
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: findMatch (general) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)}` : 'null');
      }

      if (matchedUser && matchedUser.userId !== firebaseUser.uid) {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Match found: ${matchedUser.userId.substring(0,5)}, their normalized keywords:`, matchedUser.keywords?.map(k=>k.toLowerCase()));
        setRemoteUserId(matchedUser.userId);
        const combinedKeywords = Array.from(new Set([...normalizedSearchKeywords, ...(matchedUser.keywords?.map(k => k.toLowerCase()) || [])]));
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Creating room with combined keywords:`, combinedKeywords);
        
        const assignedRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, combinedKeywords);
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Room created: ${assignedRoomId}. This user (CALLER) sets state to connecting.`);
        setRoomId(assignedRoomId);
        setIsCaller(true);
        setChatState('connecting'); 
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: CALLER state 'connecting'. Setting up local stream.`);
        await webrtcSetupLocalStreamHookRef.current();
      } else {
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: No immediate match. Updating self to 'searching'. Normalized Keywords: [${normalizedSearchKeywords.join(',')}]`);
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', normalizedSearchKeywords, null);
        
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(async () => {
          // console.log(`[ChatApp ${CUID_SHORT}] Search timeout initiated. Current chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser?.uid) { 
            console.log(`[ChatApp ${CUID_SHORT}] Search timeout! No match found for user: ${firebaseUser.uid.substring(0,5)}`);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            await handleStopChatRef.current(false); 
          }
          searchTimeoutRef.current = null; 
        }, 30000); // 30 seconds
        // console.log(`[ChatApp ${CUID_SHORT}] handleStartSearchReal: Set search timeout ID: ${searchTimeoutRef.current}`);
      }
    } catch (error) {
      console.error(`[ChatApp ${CUID_SHORT}] Error in handleStartSearchReal:`, error);
      toast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      if (chatStateRef.current !== 'idle') {
        setChatState('idle');
        setChatMode(null); // Reset chat mode on error
        if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }
  }, [firebaseUser, keywordsInput, toast, CUID_SHORT, chatMode, webrtcSetupLocalStream]); // Added chatMode and webrtcSetupLocalStream

  const handleStopChatRef = useRef(handleStopChatReal);
  const handleStartSearchRef = useRef(handleStartSearchReal);
  const webrtcSetupLocalStreamHookRef = useRef(webrtcSetupLocalStream);
  const webrtcStartCallHookRef = useRef(webrtcStartCall);

  useEffect(() => { handleStopChatRef.current = handleStopChatReal; }, [handleStopChatReal]);
  useEffect(() => { handleStartSearchRef.current = handleStartSearchReal; }, [handleStartSearchReal]);
  useEffect(() => { webrtcSetupLocalStreamHookRef.current = webrtcSetupLocalStream; }, [webrtcSetupLocalStream]);
  useEffect(() => { webrtcStartCallHookRef.current = webrtcStartCall; }, [webrtcStartCall]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Commented out activeUserCount polling to save Firestore quota
  /*
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const count = await FirestoreService.getActiveUserCount();
        setActiveUserCount(count);
      } catch (error) {
        // console.error("[ChatApp] Failed to fetch active user count:", error);
      }
    };
    // fetchCount(); // Initial fetch
    // const intervalId = setInterval(fetchCount, 60000); // Poll every 60 seconds
    // return () => clearInterval(intervalId);
  }, []);
  */

  useEffect(() => {
    if (firebaseUser?.uid) {
        const currentUid = firebaseUser.uid;
        const userStatusDocRef = doc(db, 'userStatuses', currentUid);
        // console.log(`[ChatApp ${CUID_SHORT}] Setting up onSnapshot listener for self (userStatuses/${currentUid}). Initial chatStateRef: ${chatStateRef.current}`);

        const unsubscribe = onSnapshot(userStatusDocRef, async (docSnap) => {
            const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
            
            // console.log(`[ChatApp ${CUID_SHORT}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus), ` PendingWrites: ${docSnap.metadata.hasPendingWrites}`);
            // console.log(`[ChatApp ${CUID_SHORT}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}, searchTimeoutRef active: ${searchTimeoutRef.current !== null}`);
            
            if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
                if (searchTimeoutRef.current) {
                    // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER: User status is 'chatting' with roomId ${userStatus.roomId}. Clearing search timeout ID: ${searchTimeoutRef.current}.`);
                    clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                }

                const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;
                // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER (processing 'chatting' status): isNewOrDifferentRoomForMe=${isNewOrDifferentRoomForMe}, client chatStateRef=${chatStateRef.current}, client roomIdRef=${roomIdRef.current}`);

                if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) { 
                  // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Matched! Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
                  
                  setRoomId(userStatus.roomId); 
                  setChatState('connecting'); 

                  const roomData = await FirestoreService.getRoomData(userStatus.roomId);
                  if (roomData && roomData.users) {
                    const otherUser = roomData.users.find((uid: string) => uid !== currentUid);
                    if (otherUser) {
                       setRemoteUserId(otherUser);
                       setIsCaller(false); 
                       // console.log(`[ChatApp ${CUID_SHORT}] CALLEE PATH: User is callee (other user: ${otherUser.substring(0,5)}). Setting up local stream.`);
                       await webrtcSetupLocalStreamHookRef.current(); 
                    } else {
                      console.error(`[ChatApp ${CUID_SHORT}] ERROR (CALLEE PATH): Other user not found in roomData for room ${userStatus.roomId}. Users: ${roomData.users}. My ID: ${currentUid}`);
                      toast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                      if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
                    }
                  } else {
                    console.error(`[ChatApp ${CUID_SHORT}] ERROR (CALLEE PATH): Room data not found for room ${userStatus.roomId} or users array missing.`);
                    toast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
                    if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
                  }
                } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) { 
                   // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER (CALLER PATH): Status 'chatting' for current room ${userStatus.roomId} while I am 'connecting'. Expected for caller.`);
                   if (!localStream) { 
                      // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER (CALLER PATH): Local stream not yet available, setting it up.`);
                      await webrtcSetupLocalStreamHookRef.current();
                   }
                } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && (chatStateRef.current === 'connecting' || chatStateRef.current === 'chatting')) {
                   console.warn(`[ChatApp ${CUID_SHORT}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while already in a process for room ${roomIdRef.current}. Forcing stop of old. Current state: ${chatStateRef.current}`);
                   await handleStopChatRef.current(false); 
                }
            } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current && 
                       (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                // console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER: My status in Firestore is 'idle'. Client thought it was in room ${roomIdRef.current} (state: ${chatStateRef.current}).`);
                if (!isStoppingChatRef.current) { 
                    //  console.log(`[ChatApp ${CUID_SHORT}] STATUS LISTENER: Not currently stopping locally, proceeding with cleanup due to 'idle' status from Firestore.`);
                     await handleStopChatRef.current(false);
                }
            } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                 console.warn(`[ChatApp ${CUID_SHORT}] STATUS LISTENER: My status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
                 if (!isStoppingChatRef.current && chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
            }
        }, (error) => {
            console.error(`[ChatApp ${CUID_SHORT}] Error in my user status onSnapshot listener:`, error);
        });
        
        return () => {
            // console.log(`[ChatApp ${CUID_SHORT}] Unsubscribing from my user status listener (userStatuses/${currentUid}).`);
            unsubscribe();
            if (searchTimeoutRef.current) { 
                // console.log(`[ChatApp ${CUID_SHORT}] Clearing search timeout Ref ${searchTimeoutRef.current} during self-status listener cleanup.`);
                clearTimeout(searchTimeoutRef.current);
                searchTimeoutRef.current = null;
            }
        };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, toast, CUID_SHORT]); // Removed localStream and other refs from deps, relying on stable refs

  useEffect(() => {
    if (roomId && chatState === 'chatting' && firebaseUser?.uid) {
        const unsubscribe = FirestoreService.listenForMessages(roomId, (newMessages) => {
            setMessages(prevMessages => {
                const existingMessageIds = new Set(prevMessages.map(m => m.id));
                const uniqueNewMessages = newMessages.filter(nm => !existingMessageIds.has(nm.id));
                return [...prevMessages, ...uniqueNewMessages]
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                    .map(msg => ({ ...msg, isLocalUser: msg.userId === firebaseUser.uid }));
            });
        });
        return () => unsubscribe();
    }
  }, [roomId, chatState, firebaseUser?.uid]);
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
        // console.log(`[ChatApp ${CUID_SHORT}] Attempting to start WebRTC call. Room: ${roomId}, Is Caller: ${isCaller}, PC State: ${peerConnectionRef.current?.signalingState}, localStream tracks: ${localStream?.getTracks().length}`);
        if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === 'closed') {
            // console.log(`[ChatApp ${CUID_SHORT}] Creating new PeerConnection for startCall (isCaller: ${isCaller}).`);
            webrtcStartCallHookRef.current(isCaller);
        } else if (['stable', 'have-local-offer', 'have-remote-offer'].includes(peerConnectionRef.current.signalingState)) {
            //  console.log(`[ChatApp ${CUID_SHORT}] PC exists (state: ${peerConnectionRef.current.signalingState}), re-initiating call process (isCaller: ${isCaller}).`);
             webrtcStartCallHookRef.current(isCaller);
        }
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, CUID_SHORT, peerConnectionRef]);

  useEffect(() => {
    if (chatState === 'chatting' && remoteUserId) {
      const fetchLocation = async () => {
        try {
          // console.log(`[ChatApp ${CUID_SHORT}] Fetching IP location...`);
          const response: GetIpLocationOutput = await getIpLocation({}); // No input needed for this version
          if (response && response.country) {
            // Basic flag emoji getter (very simplified)
            const getFlagEmoji = (countryCode: string | undefined) => {
              if (!countryCode) return '🏳️'; // Default flag
              // Simple mapping for a few countries, extend as needed
              const flags: Record<string, string> = { US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧', FR: '🇫🇷', DE: '🇩🇪', JP: '🇯🇵' };
              return flags[countryCode.toUpperCase()] || `(${countryCode})`;
            };
            setPartnerLocationDisplay(`${response.country} ${getFlagEmoji(response.countryCode)}`);
          } else {
            setPartnerLocationDisplay("Location: Unknown");
          }
        } catch (error) {
          console.error("Error fetching IP location:", error);
          setPartnerLocationDisplay("Location: Error");
        }
      };
      fetchLocation();
    } else {
      setPartnerLocationDisplay(null); // Clear when not chatting
    }
  }, [chatState, remoteUserId, CUID_SHORT]);

  const handleSendMessage = useCallback(async () => {
    if (!currentMessage.trim() || !firebaseUser || !roomId || chatState !== 'chatting') return;
    const moderationInput: ModerateTextInput = { text: currentMessage };
    try {
      const moderationResult = await moderateText(moderationInput);
      if (!moderationResult.isSafe) {
        toast({ title: "Message Moderated", description: `Your message was flagged: ${moderationResult.reason || 'Reason not provided'}. Not sent.`, variant: "destructive" });
        setCurrentMessage('');
        return;
      }
    } catch (error) {
      console.error("Moderation error:", error);
      toast({ title: "Moderation Error", description: "Could not moderate message. Please try again.", variant: "destructive" });
      return;
    }
    const newMessagePayload: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> = {
      userId: firebaseUser.uid,
      text: currentMessage,
      originalText: currentMessage, // Store original for translation purposes
    };
    try {
      await FirestoreService.sendMessage(roomId, newMessagePayload);
      setCurrentMessage('');
    } catch (error) {
      console.error("Error sending message:", error);
      toast({ title: "Send Error", description: "Could not send message.", variant: "destructive" });
    }
  }, [currentMessage, firebaseUser, roomId, chatState, toast]);

  const handleTranslateMessage = useCallback(async (messageId: string, textToTranslate: string, context: string): Promise<{ translatedText: string } | { error: string }> => {
    try {
      const targetLanguage = navigator.language.split('-')[0] || 'en';
      // console.log(`[ChatApp ${CUID_SHORT}] Translating message ${messageId} to ${targetLanguage}. Context: ${context.substring(0,50)}...`);
      const translationInput: TranslateMessageInput = { text: textToTranslate, sourceLanguage: "auto", targetLanguage: targetLanguage, context: context };
      const result = await translateMessage(translationInput);
      
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId 
            ? { ...msg, text: result.translatedText, translatedText: result.translatedText, isTranslating: false, translationError: undefined } 
            : msg
        )
      );
      return { translatedText: result.translatedText };
    } catch (error) {
      console.error("Translation API error:", error);
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId 
            ? { ...msg, translationError: "Failed to translate", isTranslating: false } 
            : msg
        )
      );
      return { error: "Failed to translate." };
    }
  }, [CUID_SHORT]);

  const getConversationContext = useCallback((): string => {
    return messages.slice(-5).map(m => `${m.isLocalUser ? 'Me' : 'Partner'}: ${m.originalText || m.text}`).join('\n');
  }, [messages]);

  if (!firebaseUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-amber-50 text-foreground">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg">Initializing Chatter Anon...</p>
      </div>
    );
  }

  const isUiInteractionDisabled = chatState === 'searching' || chatState === 'connecting';
  const showLandingPage = chatState === 'idle' && !chatMode;
  const showActiveChatInterface = roomId && (chatState === 'connecting' || chatState === 'chatting');

  if (showLandingPage) {
    return (
      <div className="min-h-screen bg-amber-50 text-gray-800 flex flex-col">
        <header className="py-4 px-6 md:px-10 flex justify-between items-center">
          <div className="text-3xl font-bold text-blue-600">Chatter Anon</div>
          {/* {activeUserCount !== null && ( // Active user count disabled for now
            <Badge variant="outline" className="text-sm border-blue-500 text-blue-600">
              <Users className="mr-2 h-4 w-4" />
              {activeUserCount} online
            </Badge>
          )} */}
        </header>

        <main className="flex-grow flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-2xl rounded-lg bg-card">
            <CardContent className="p-6 md:p-8 text-center">
              <h1 className="text-2xl md:text-3xl font-bold mb-3 text-foreground">Talk to strangers with your interests!</h1>
              <p className="text-muted-foreground mb-6 text-sm md:text-base">
                Chatter Anon is the new Omegle alternative, where you can meet new friends. When you use Chatter Anon, you are paired in a random chat with a stranger.
              </p>

              <div className="mb-6">
                <p className="font-semibold mb-2 text-foreground">Start chatting:</p>
                <div className="flex justify-center space-x-3">
                  <Button 
                    size="lg" 
                    className="bg-[hsl(var(--uhmegle-blue))] hover:bg-[hsl(var(--uhmegle-blue)/0.9)] text-uhmegle-blue-foreground font-semibold py-3 px-6 rounded-md text-base"
                    onClick={() => handleStartSearchRef.current('text')}
                    disabled={isUiInteractionDisabled}
                  >
                    <MessageCircle className="mr-2 h-5 w-5" /> Text
                  </Button>
                  <span className="self-center text-muted-foreground">or</span>
                  <Button 
                    size="lg" 
                    className="bg-[hsl(var(--uhmegle-blue))] hover:bg-[hsl(var(--uhmegle-blue)/0.9)] text-uhmegle-blue-foreground font-semibold py-3 px-6 rounded-md text-base"
                    onClick={() => handleStartSearchRef.current('video')}
                    disabled={isUiInteractionDisabled}
                  >
                    <Video className="mr-2 h-5 w-5" /> Video
                  </Button>
                </div>
              </div>

              <div className="mb-6">
                <label htmlFor="keywords" className="block font-semibold mb-2 text-foreground">What do you wanna talk about?</label>
                <Input
                  id="keywords"
                  type="text"
                  placeholder="Add your interests (optional, comma-separated)"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  className="text-center text-sm"
                  disabled={isUiInteractionDisabled}
                />
              </div>

              <Alert variant="default" className="mb-6 bg-blue-100 border-blue-300 text-blue-700">
                <Info className="h-5 w-5 !text-blue-700" />
                <AlertTitle className="font-semibold">Video is monitored. Keep it clean!</AlertTitle>
              </Alert>

              <p className="text-xs text-muted-foreground mb-2">
                Want more relevant chats? Add your interests on Chatter Anon to instantly connect with strangers who share your vibe! Skip the awkward intros and dive into conversations about things you both love. It's a smarter way to meet new people and why many see Chatter Anon as a top Omegle alternative.
              </p>
              <p className="text-xs text-muted-foreground">
                Your safety matters on Chatter Anon. Chats are anonymous by default (we recommend keeping it that way!), and you can end any chat instantly. See our Chat Rules for clear guidelines on how to interact. For more, check our Blog or FAQ.
              </p>
            </CardContent>
          </Card>
        </main>

        <footer className="py-4 text-center text-xs text-muted-foreground border-t border-gray-300">
          ChatterAnon.com &bull;
          <a href="#" className="hover:underline mx-1">Rules</a> &bull;
          <a href="#" className="hover:underline mx-1">Terms Of Service</a> &bull;
          <a href="#" className="hover:underline mx-1">Privacy</a> &bull;
          <a href="#" className="hover:underline mx-1">Blog</a> &bull;
          <a href="#" className="hover:underline mx-1">FAQ</a>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b border-border shadow-sm bg-card flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
        {/* {activeUserCount !== null && ( // Active user count disabled
          <Badge variant="secondary" className="text-sm">
            <Users className="mr-2 h-4 w-4" />
            {activeUserCount} Active Users
          </Badge>
        )} */}
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {chatState === 'searching' && !roomId && (
           <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">Finding a Chat Partner...</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Searching for someone {keywordsInput ? `interested in: ${keywordsInput}` : 'available to chat'}.</p>
               <Button onClick={() => handleStopChatRef.current(false)} variant="outline" size="sm" className="mt-6">
                Cancel Search
              </Button>
            </CardContent>
          </Card>
        )}

        {(chatState === 'connecting' || chatState === 'chatting' || localStream || remoteStream) && chatMode === 'video' && (
          <VideoArea localStream={localStream} remoteStream={remoteStream} isChatting={chatState === 'chatting'} />
        )}

        {showActiveChatInterface && (
          <Card className="flex-1 flex flex-col shadow-lg overflow-hidden">
            <CardHeader className="p-4 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <MessageSquare className="mr-2 h-5 w-5 text-primary" />
                    {chatState === 'connecting' ? 'Connecting to Stranger...' : "You're now chatting with a random stranger"}
                  </CardTitle>
                  {chatState === 'chatting' && (
                    <CardDescription className="text-sm text-muted-foreground mt-1">
                       {partnerLocationDisplay || "Location: Unknown"}
                    </CardDescription>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleStopChatRef.current(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10">
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChatRef.current(false)} variant="destructive" size="sm">
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
                  reportingUserId={firebaseUser?.uid || null}
                  currentRoomId={roomId}
                  onSubmitReport={async (data) => FirestoreService.createReport(data)}
                  disabled={chatState !== 'chatting' || !remoteUserId}
                />
              </div>
            </CardFooter>
          </Card>
        )}

        {chatState === 'idle' && chatMode && !showLandingPage && !showActiveChatInterface && (
           <Card className="w-full max-w-md mx-auto shadow-xl">
            <CardHeader>
                <CardTitle className="text-xl text-center">Start a New Chat</CardTitle>
                <CardDescription className="text-center">You ended your previous chat. Start a new one?</CardDescription>
            </CardHeader>
             <CardContent className="p-6 text-center">
               <div className="mb-4">
                 <label htmlFor="keywords-restart" className="block font-semibold mb-2 text-foreground">Update your interests (optional)</label>
                 <Input
                   id="keywords-restart"
                   type="text"
                   placeholder="Add your interests (optional, comma-separated)"
                   value={keywordsInput}
                   onChange={(e) => setKeywordsInput(e.target.value)}
                   className="text-center text-sm"
                 />
               </div>
               <Button onClick={() => handleStartSearchRef.current(chatMode)} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground" size="lg">
                 {isUiInteractionDisabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                 Find New Stranger ({chatMode === 'text' ? 'Text' : 'Video'})
               </Button>
               <Button onClick={() => setChatMode(null)} variant="link" className="mt-2">Back to main options</Button>
             </CardContent>
           </Card>
        )}
      </main>
    </div>
  );
}


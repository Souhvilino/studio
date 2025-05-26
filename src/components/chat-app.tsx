
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { VideoArea } from './video-area';
import { MessageItem } from './MessageItem';
import { ReportDialog } from './report-dialog';
import { useFirebaseAuth } from './firebase-auth-provider';
import type { ChatMessage, ChatState as AppChatState, ReportData, UserStatusData } from '@/types'; 
import { Send, Loader2, MessageSquare, XCircle, RotateCcw, Users, Info, MessageCircle, Video, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { moderateText, type ModerateTextInput } from '@/ai/flows/ai-moderation';
import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation';
import { getIpLocation, type GetIpLocationOutput } from '@/ai/flows/get-ip-location-flow';
import * as FirestoreService from '@/lib/firestore-service';
import { useWebRTCSignaling } from '@/hooks/use-webrtc-signaling';
import { db } from '@/lib/firebase'; 
import { onSnapshot, doc } from 'firebase/firestore';


type ChatMode = 'text' | 'video' | null;

function getFlagEmoji(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🏳️'; // Default flag or empty if no code
  const ccUpper = countryCode.toUpperCase();
  // Offset between uppercase A and regional indicator symbol A
  // 0x1F1E6 is Regional Indicator Symbol Letter A
  // 'A'.charCodeAt(0) is 65
  const offset = 0x1F1E6 - 'A'.charCodeAt(0);
  const firstChar = String.fromCodePoint(ccUpper.charCodeAt(0) + offset);
  const secondChar = String.fromCodePoint(ccUpper.charCodeAt(1) + offset);
  return `${firstChar}${secondChar}`;
}


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
  // const [activeUserCount, setActiveUserCount] = useState<number | null>(null); // Temporarily disabled
  const [partnerLocationDisplay, setPartnerLocationDisplay] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GetIpLocationOutput | null>(null);


  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  
  const chatStateRef = useRef(chatState);
  const roomIdRef = useRef(roomId);
  const isStoppingChatRef = useRef(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const CUID_SHORT = firebaseUser?.uid.substring(0,5) || 'anon';

  useEffect(() => {
    chatStateRef.current = chatState;
  }, [chatState]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const onLocalStreamCallback = useCallback((stream: MediaStream | null) => {
    setLocalStream(stream);
  }, []);

  const onRemoteStreamCallback = useCallback((stream: MediaStream | null) => {
    console.log(`[ChatApp ${CUID_SHORT}] onRemoteStreamCallback called. Stream: ${stream ? stream.id : 'null'}`);
    setRemoteStream(stream);
  }, [CUID_SHORT]);
  
  const onConnectionStateChange = useCallback((state: RTCIceConnectionState | string) => {
    const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-conn';
    console.log(`[${localCUID}] WebRTC Connection State: ${state}, isStoppingChatRef.current: ${isStoppingChatRef.current}, current chatState: ${chatStateRef.current}`); // Use chatStateRef for logging
    
    if (isStoppingChatRef.current && (state === 'failed' || state === 'disconnected' || state === 'closed')) {
      console.log(`[${localCUID}] onConnectionStateChange: Chat is already stopping or has stopped, ignoring further cleanup/toast from WebRTC state ${state}.`);
      return;
    }

    if (state === 'connected') {
      console.log(`[${localCUID}] onConnectionStateChange: newState is 'connected'. Current chatState: ${chatStateRef.current}. Setting to 'chatting'.`);
      if (chatStateRef.current !== 'chatting') {
        setChatState('chatting'); 
        toast({ title: "Connected!", description: "You are now chatting with a partner." });
      }
    } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      if (!isStoppingChatRef.current && chatStateRef.current !== 'idle' && chatStateRef.current !== 'searching' && chatStateRef.current !== 'closed') {
        console.log(`[${localCUID}] onConnectionStateChange: Connection lost/closed (state: ${state}), chatState was ${chatStateRef.current}. Triggering handleStopChat.`);
        
        const currentChatStateBeforeToast = chatStateRef.current;
        if (currentChatStateBeforeToast !== 'idle' && currentChatStateBeforeToast !== 'closed') { 
          toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
        }
        handleStopChatRef.current(false); 
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, toast]); // Removed chatState, handleStopChatRef uses .current

  const {
    peerConnection,
    startCall: webrtcStartCall,
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStreamHook,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: onLocalStreamCallback,
    onRemoteStream: onRemoteStreamCallback,
    onConnectionStateChange,
  });

  const handleStopChat = useCallback(async (initiateNewSearch = false) => {
    const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-stop';
    if (isStoppingChatRef.current && !initiateNewSearch) { 
      console.log(`[${localCUID}] handleStopChatReal: Already stopping (isStoppingChatRef=${isStoppingChatRef.current}) and not initiating new search. Early exit.`);
      return;
    }
    console.log(`[${localCUID}] handleStopChatReal CALLED. isStoppingRef was: ${isStoppingChatRef.current}, current chatState: ${chatStateRef.current}, newSearch: ${initiateNewSearch}, currentRoomId: ${roomIdRef.current}`);
    isStoppingChatRef.current = true;

    try {
      const previousRoomId = roomIdRef.current;
      const previousChatState = chatStateRef.current; 
      console.log(`[${localCUID}] handleStopChatReal: prevRoomId=${previousRoomId}, prevChatState=${previousChatState}`);

      if (searchTimeoutRef.current) {
          console.log(`[${localCUID}] handleStopChatReal: Clearing search timeout ID: ${searchTimeoutRef.current}.`);
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
      }

      setChatState('idle'); 
      setRoomId(null);
      setRemoteUserId(null);
      setMessages([]);
      setIsCaller(false);
      setPartnerLocationDisplay(null); 
      
      console.log(`[${localCUID}] handleStopChatReal: Calling webrtcCleanup for room ${previousRoomId}.`);
      webrtcCleanup(); 

      if (firebaseUser) {
        if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
            console.log(`[${localCUID}] handleStopChatReal: Firestore cleanup for user ${firebaseUser.uid} in room ${previousRoomId}.`);
            await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid);
        } else if (previousChatState === 'searching' && (!previousRoomId || previousRoomId !== roomIdRef.current )) { 
            console.log(`[${localCUID}] handleStopChatReal: Was searching (state: ${previousChatState}, room: ${previousRoomId}). Ensuring user status is idle for ${firebaseUser.uid}.`);
            await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null, null); // Explicitly null location
        } else if (previousChatState !== 'idle' && previousChatState !== 'closed') { 
           console.log(`[${localCUID}] handleStopChatReal: Not 'chatting', 'connecting', or 'searching', but was ${previousChatState}. Ensuring user status ${firebaseUser.uid} is idle.`);
           await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null, null); // Explicitly null location
        }
      }
      
      if (initiateNewSearch && firebaseUser && chatMode && handleStartSearchRef.current) { 
        console.log(`[${localCUID}] handleStopChatReal: Initiating new search with mode ${chatMode}.`);
        isStoppingChatRef.current = false; // Reset for the new search
        console.log(`[${localCUID}] handleStopChatReal: isStoppingChatRef reset to false for new search.`);
        setTimeout(() => {
            if (handleStartSearchRef.current && chatMode) { 
                handleStartSearchRef.current(chatMode); 
            }
        }, 100); 
      } else {
        if (!initiateNewSearch && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
            toast({ title: "Chat Ended", description: "The chat session has been closed." });
        }
        if (!initiateNewSearch) { 
          setChatMode(null); 
          setKeywordsInput(''); // Clear keywords when going back to main options
        }
      }
    } finally {
      if (!initiateNewSearch) {
        isStoppingChatRef.current = false;
        console.log(`[${localCUID}] handleStopChatReal: FINALLY (no new search). Setting isStoppingChatRef.current = false.`);
      }
    }
  }, [firebaseUser, webrtcCleanup, toast, chatMode]); // Added chatMode dependency
  
  const handleStartSearch = useCallback(async (selectedChatMode: ChatMode) => {
    const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-search';
    console.log(`[${localCUID}] handleStartSearchReal called with raw keywordsInput: "${keywordsInput}", selectedChatMode: ${selectedChatMode}`);
    
    if (searchTimeoutRef.current) {
        console.log(`[${localCUID}] handleStartSearchReal: Clearing PREVIOUS search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
    }

    if (!selectedChatMode) {
        console.warn(`[${localCUID}] handleStartSearchReal: No chatMode selected.`);
        toast({ title: "Error", description: "Please select a chat mode (Text or Video).", variant: "destructive"});
        return;
    }
    
    if (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting') {
        console.log(`[${localCUID}] handleStartSearchReal: Already in state ${chatStateRef.current}. Stopping current chat first.`);
        await handleStopChatRef.current(false); // Ensure handleStopChatRef.current is used
    }

    setChatMode(selectedChatMode); 
    setChatState('searching');
    toast({ title: "Searching...", description: "Looking for a chat partner." });

    if (!firebaseUser) {
        toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
        setChatState('idle'); 
        setChatMode(null);
        return;
    }

    // Fetch client's own location
    let clientLocationData: GetIpLocationOutput | null = null;
    try {
      console.log(`[${localCUID}] handleStartSearchReal: Fetching client IP location...`);
      const response = await fetch('https://freeipapi.com/api/json');
      if (response.ok) {
        clientLocationData = await response.json() as GetIpLocationOutput;
        setUserLocation(clientLocationData); // Store for potential future use
        console.log(`[${localCUID}] handleStartSearchReal: Client IP Location fetched:`, clientLocationData?.countryName);
      } else {
        console.warn(`[${localCUID}] handleStartSearchReal: Failed to fetch client IP location, status: ${response.status}`);
      }
    } catch (err) {
      console.error(`[${localCUID}] handleStartSearchReal: Error fetching client IP location:`, err);
    }


    const normalizedSearchKeywords = keywordsInput.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    console.log(`[${localCUID}] handleStartSearchReal: Normalized searchKeywords: [${normalizedSearchKeywords.join(',')}]`);

    let matchedUser: UserStatusData | null = null;
    try {
      if (normalizedSearchKeywords.length > 0) {
        console.log(`[${localCUID}] handleStartSearchReal: Attempting match WITH normalized keywords:`, normalizedSearchKeywords);
        matchedUser = await FirestoreService.findMatch(firebaseUser.uid, normalizedSearchKeywords);
        console.log(`[${localCUID}] handleStartSearchReal: findMatch (with keywords) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)} - Keywords: ${JSON.stringify(matchedUser.keywords)}` : 'null');
      }
        
      if (!matchedUser) {
        console.log(`[${localCUID}] handleStartSearchReal: No match with keywords (or no keywords provided), trying to find any searching user.`);
        matchedUser = await FirestoreService.findMatch(firebaseUser.uid, []); 
        console.log(`[${localCUID}] handleStartSearchReal: findMatch (general) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)} - Keywords: ${JSON.stringify(matchedUser.keywords)}` : 'null');
      }

      if (matchedUser && matchedUser.userId !== firebaseUser.uid) {
        console.log(`[${localCUID}] handleStartSearchReal: Match found: ${matchedUser.userId.substring(0,5)}, their normalized keywords:`, matchedUser.keywords?.map(k=>k.toLowerCase()));
        setRemoteUserId(matchedUser.userId);
        const combinedKeywords = Array.from(new Set([...normalizedSearchKeywords, ...(matchedUser.keywords?.map(k => k.toLowerCase()) || [])]));
        console.log(`[${localCUID}] handleStartSearchReal: Creating room with combined keywords:`, combinedKeywords);
        
        // Update self status with location before creating room
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'chatting', normalizedSearchKeywords, null, clientLocationData);

        const assignedRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, combinedKeywords);
        console.log(`[${localCUID}] handleStartSearchReal: Room created: ${assignedRoomId}. This user (CALLER) sets state to connecting.`);
        setRoomId(assignedRoomId);
        setIsCaller(true);
        setChatState('connecting'); 
        if (webrtcSetupLocalStreamHookRef.current) { // Use .current
          console.log(`[${localCUID}] handleStartSearchReal: CALLER state 'connecting'. Setting up local stream.`);
          await webrtcSetupLocalStreamHookRef.current(); // Use .current
        }
      } else {
        console.log(`[${localCUID}] handleStartSearchReal: No immediate match. Updating self to 'searching'. Normalized Keywords: [${normalizedSearchKeywords.join(',')}]`);
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', normalizedSearchKeywords, null, clientLocationData); 
        
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); 
        searchTimeoutRef.current = setTimeout(async () => {
          console.log(`[${localCUID}] Search timeout initiated. Current chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}, isStoppingChatRef: ${isStoppingChatRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser?.uid && !isStoppingChatRef.current) { 
            console.log(`[${localCUID}] Search timeout! No match found for user: ${firebaseUser.uid.substring(0,5)}`);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            await handleStopChatRef.current(false); // Use .current
          } else {
             console.log(`[${localCUID}] Search timeout condition not met or already resolved. chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          }
          searchTimeoutRef.current = null; 
        }, 30000); 
        console.log(`[${localCUID}] handleStartSearchReal: Set search timeout ID: ${searchTimeoutRef.current}`);
      }
    } catch (error) {
      console.error(`[${localCUID}] Error in handleStartSearchReal:`, error);
      toast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      if (chatStateRef.current !== 'idle') { 
        setChatState('idle');
        setChatMode(null);
        if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null, null);
      }
    }
  }, [firebaseUser, keywordsInput, toast]);

  // Stable refs for callbacks
  const handleStopChatRef = useRef(handleStopChat);
  const handleStartSearchRef = useRef(handleStartSearch);
  const webrtcSetupLocalStreamHookRef = useRef(webrtcSetupLocalStreamHook);
  const webrtcStartCallRef = useRef(webrtcStartCall);

  useEffect(() => { handleStopChatRef.current = handleStopChat; }, [handleStopChat]);
  useEffect(() => { handleStartSearchRef.current = handleStartSearch; }, [handleStartSearch]);
  useEffect(() => { webrtcSetupLocalStreamHookRef.current = webrtcSetupLocalStreamHook; }, [webrtcSetupLocalStreamHook]);
  useEffect(() => { webrtcStartCallRef.current = webrtcStartCall; }, [webrtcStartCall]);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  useEffect(() => {
    if (firebaseUser?.uid) {
        const currentUid = firebaseUser.uid; 
        const userStatusDocRef = doc(db, 'userStatuses', currentUid);
        console.log(`[${currentUid.substring(0,5)}] Setting up onSnapshot listener for self (userStatuses/${currentUid}). Initial chatStateRef: ${chatStateRef.current}`);

        const unsubscribe = onSnapshot(userStatusDocRef, async (docSnap) => {
            const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
            
            console.log(`[${currentUid.substring(0,5)}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus), ` PendingWrites: ${docSnap.metadata.hasPendingWrites}`);
            console.log(`[${currentUid.substring(0,5)}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}, searchTimeoutRef active: ${searchTimeoutRef.current !== null}`);
            
            if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
                if (searchTimeoutRef.current) {
                    console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: User status is 'chatting' with roomId ${userStatus.roomId}. Clearing search timeout ID: ${searchTimeoutRef.current}.`);
                    clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                }

                const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;
                console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER (processing 'chatting' status): isNewOrDifferentRoomForMe=${isNewOrDifferentRoomForMe}, client chatStateRef=${chatStateRef.current}, client roomIdRef=${roomIdRef.current}`);

                if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) { 
                  console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Matched! Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
                  
                  setRoomId(userStatus.roomId); 
                  setChatState('connecting'); 

                  const roomData = await FirestoreService.getRoomData(userStatus.roomId);
                  if (roomData && roomData.users) {
                    const otherUser = roomData.users.find((uid: string) => uid !== currentUid);
                    if (otherUser) {
                       setRemoteUserId(otherUser);
                       setIsCaller(false); 
                       console.log(`[${currentUid.substring(0,5)}] CALLEE PATH: User is callee (other user: ${otherUser.substring(0,5)}). Setting up local stream.`);
                       await webrtcSetupLocalStreamHookRef.current(); 
                    } else {
                      console.error(`[${currentUid.substring(0,5)}] ERROR (CALLEE PATH): Other user not found in roomData for room ${userStatus.roomId}. Users: ${roomData.users}. My ID: ${currentUid}`);
                      toast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                      if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
                    }
                  } else {
                    console.error(`[${currentUid.substring(0,5)}] ERROR (CALLEE PATH): Room data not found for room ${userStatus.roomId} or users array missing.`);
                    toast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
                     if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
                  }
                } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) { 
                   console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER (CALLER PATH): Status 'chatting' for current room ${userStatus.roomId} while I am 'connecting'. Expected for caller.`);
                   if (!localStream && webrtcSetupLocalStreamHookRef.current) { 
                      console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER (CALLER PATH): Local stream not yet available, setting it up.`);
                      await webrtcSetupLocalStreamHookRef.current();
                   }
                } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && (chatStateRef.current === 'connecting' || chatStateRef.current === 'chatting')) {
                   console.warn(`[${currentUid.substring(0,5)}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while already in a process for room ${roomIdRef.current}. Forcing stop of old. Current state: ${chatStateRef.current}`);
                   if (!isStoppingChatRef.current) await handleStopChatRef.current(false); 
                } else if (roomIdRef.current === userStatus.roomId && chatStateRef.current === 'chatting') {
                  console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: Already in 'chatting' state for room ${userStatus.roomId}. No state change needed.`);
                } else {
                   console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER (chatting status): No specific action taken for this 'chatting' update. isNewOrDifferentRoom: ${isNewOrDifferentRoomForMe}, Client ChatState: ${chatStateRef.current}, Client RoomId: ${roomIdRef.current}`);
                }

            } else if (userStatus && userStatus.status === 'idle' && 
                       (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: My status in Firestore is 'idle'. Client thought it was in room ${roomIdRef.current} (state: ${chatStateRef.current}). isStoppingChatRef.current: ${isStoppingChatRef.current}`);
                if (!isStoppingChatRef.current && roomIdRef.current) { // Only cleanup if we were in a room and not already stopping.
                     console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: Not currently stopping locally, proceeding with cleanup due to 'idle' status from Firestore while client was in room ${roomIdRef.current}.`);
                     await handleStopChatRef.current(false);
                } else {
                     console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: Currently stopping locally or no current room, 'idle' status from Firestore likely reflects this or is irrelevant to an active chat. No new cleanup action from here.`);
                }
            } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                 console.warn(`[${currentUid.substring(0,5)}] STATUS LISTENER: My status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side if not already stopping.`);
                 if (!isStoppingChatRef.current && chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
            } else {
                console.log(`[${currentUid.substring(0,5)}] STATUS LISTENER: No specific state-changing action taken for my status: ${userStatus?.status}, my Firestore roomId: ${userStatus?.roomId}. My client refs: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);
            }
        }, (error) => {
            console.error(`[${currentUid.substring(0,5)}] Error in my user status onSnapshot listener:`, error);
        });
        
        return () => {
            console.log(`[${currentUid.substring(0,5)}] Unsubscribing from my user status listener (userStatuses/${currentUid}).`);
            unsubscribe();
            if (searchTimeoutRef.current) { 
                console.log(`[${currentUid.substring(0,5)}] Clearing search timeout Ref ${searchTimeoutRef.current} during self-status listener cleanup.`);
                clearTimeout(searchTimeoutRef.current);
                searchTimeoutRef.current = null;
            }
        };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]); 
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      const localCUID = firebaseUser.uid.substring(0,5);
      console.log(`[${localCUID}] Attempting to start WebRTC call. Room: ${roomId}, Is Caller: ${isCaller}, PC State: ${peerConnection.current?.signalingState}, localStream tracks: ${localStream?.getTracks().length}`);
      if (webrtcStartCallRef.current) { // Use .current
          if (!peerConnection.current || peerConnection.current.signalingState === 'closed') {
              console.log(`[${localCUID}] Creating new PeerConnection for startCall (isCaller: ${isCaller}).`);
              webrtcStartCallRef.current(isCaller); 
          } else if (['stable', 'have-local-offer', 'have-remote-offer', 'new'].includes(peerConnection.current.signalingState) ) { 
               console.log(`[${localCUID}] PC exists (state: ${peerConnection.current.signalingState}), (re)-initiating call process (isCaller: ${isCaller}).`);
               webrtcStartCallRef.current(isCaller); 
          } else {
               console.log(`[${localCUID}] PC exists but not in a state to start/restart call, current state: ${peerConnection.current.signalingState}. Waiting.`);
          }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatState, roomId, firebaseUser?.uid, remoteUserId, localStream, isCaller]); 
  
  useEffect(() => {
    if (chatState === 'chatting' && remoteUserId) {
      const fetchPartnerLocation = async () => {
        try {
          console.log(`[${CUID_SHORT}] Fetching partner (${remoteUserId.substring(0,5)}) location...`);
          const partnerStatus = await FirestoreService.getUserStatus(remoteUserId);
          if (partnerStatus && partnerStatus.countryName) {
            const flag = getFlagEmoji(partnerStatus.countryCode);
            setPartnerLocationDisplay(`${partnerStatus.countryName} ${flag}`);
          } else if (partnerStatus && partnerStatus.countryCode) { // Fallback to code if name is missing
            const flag = getFlagEmoji(partnerStatus.countryCode);
            setPartnerLocationDisplay(`Country Code: ${partnerStatus.countryCode} ${flag}`);
          } else {
            setPartnerLocationDisplay("Location: Unknown");
          }
        } catch (error) {
          console.error(`[${CUID_SHORT}] Error fetching partner location:`, error);
          setPartnerLocationDisplay("Location: Error");
        }
      };
      fetchPartnerLocation();
    } else {
      setPartnerLocationDisplay(null); 
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
      originalText: currentMessage, 
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
      const translationInput: TranslateMessageInput = { text: textToTranslate, sourceLanguage: "auto", targetLanguage: targetLanguage, context: context };
      const result = await translateMessage(translationInput);
      
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messageId 
            ? { ...msg, text: result.translatedText, translatedText: result.translatedText, originalText: msg.originalText || textToTranslate, isTranslating: false, translationError: undefined } 
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
  }, []); 

  const getConversationContext = useCallback((): string => {
    return messages.slice(-5).map(m => `${m.isLocalUser ? 'Me' : 'Stranger'}: ${m.originalText || m.text}`).join('\n');
  }, [messages]);


  if (!firebaseUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
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
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="py-4 px-6 md:px-10 flex justify-between items-center">
          <div className="text-3xl font-bold text-primary">Chatter Anon</div>
        </header>

        <main className="flex-grow flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-2xl rounded-lg bg-card text-card-foreground">
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
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-6 rounded-md text-base"
                    onClick={() => handleStartSearchRef.current('text')}
                    disabled={isUiInteractionDisabled}
                  >
                    <MessageCircle className="mr-2 h-5 w-5" /> Text
                  </Button>
                  <span className="self-center text-muted-foreground">or</span>
                  <Button 
                    size="lg" 
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 px-6 rounded-md text-base"
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

              <Alert variant="default" className="mb-6 bg-primary/10 border-primary/30 text-primary">
                <Info className="h-5 w-5 !text-primary" />
                <AlertTitle className="font-semibold">Video is monitored. Keep it clean!</AlertTitle>
              </Alert>

              <p className="text-xs text-muted-foreground mb-2">
                Want more relevant chats? Add your interests on Chatter Anon to instantly connect with strangers who share your vibe! Skip the awkward intros and dive into conversations about things you both love. It's a smarter way to meet new people and why many see Chatter Anon as a top Omegle alternative.
              </p>
              <p className="text-xs text-muted-foreground">
                Your safety matters on Chatter Anon. Chats are anonymous by default (we recommend keeping it that way!), and you can end any chat instantly. See our <Link href="/rules" className="underline hover:text-primary">Chat Rules</Link> for clear guidelines on how to interact. For more, check our <Link href="/blog" className="underline hover:text-primary">Blog</Link> or <Link href="/faq" className="underline hover:text-primary">FAQ</Link>.
              </p>
            </CardContent>
            <CardFooter className="flex-col gap-2 items-center justify-center p-4 text-xs text-muted-foreground border-t">
              <p>
                By using Chatter Anon you agree to our <Link href="/terms" className="underline hover:text-primary">Terms of Service</Link> and <Link href="/privacy" className="underline hover:text-primary">Privacy Policy</Link>.
              </p>
              <div className="flex gap-2 flex-wrap justify-center">
                <Link href="/rules" className="hover:underline">Rules</Link> &bull;
                <Link href="/terms" className="hover:underline">Terms</Link> &bull;
                <Link href="/privacy" className="hover:underline">Privacy</Link> &bull;
                <Link href="/blog" className="hover:underline">Blog</Link> &bull;
                <Link href="/faq" className="hover:underline">FAQ</Link>
              </div>
            </CardFooter>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b shadow-sm bg-card flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
        {/* Removed Active User Count for now due to quota issues */}
        {/* {activeUserCount !== null && (
          <Badge variant="outline" className="text-sm">
            <Users className="mr-2 h-4 w-4" /> {activeUserCount} Online
          </Badge>
        )} */}
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {chatState === 'searching' && !roomId && (
           <Card className="shadow-lg bg-card text-card-foreground">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Finding a Chat Partner...</CardTitle>
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
          <Card id="chat-area-for-screenshot" className="flex-1 flex flex-col shadow-lg overflow-hidden bg-card text-card-foreground">
            <CardHeader className="p-4 border-b">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-lg flex items-center text-foreground">
                    <MessageSquare className="mr-2 h-5 w-5 text-primary" />
                    {chatState === 'connecting' ? 'Connecting to Stranger...' : "You're now chatting with a random stranger"}
                  </CardTitle>
                  {chatState === 'chatting' && partnerLocationDisplay && (
                    <div className="text-sm text-muted-foreground mt-1">
                       {partnerLocationDisplay}
                    </div>
                  )}
                   {chatState === 'chatting' && !partnerLocationDisplay && (
                    <div className="text-sm text-muted-foreground mt-1 italic">
                       Location: Unknown
                    </div>
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
                  <MessageItem key={msg.id} message={{...msg, isLocalUser: msg.userId === firebaseUser?.uid}} onTranslate={handleTranslateMessage} conversationContext={getConversationContext()} />
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
                <Button onClick={handleSendMessage} disabled={chatState !== 'chatting' || !currentMessage.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Send className="h-4 w-4" />
                </Button>
                <ReportDialog
                  reportedUserId={remoteUserId}
                  reportingUserId={firebaseUser?.uid || null}
                  currentRoomId={roomId}
                  chatAreaScreenshotId="chat-area-for-screenshot"
                  onSubmitReport={async (data) => FirestoreService.createReport(data as Omit<ReportData, 'id' | 'timestamp' | 'timestampDate'>)}
                  disabled={chatState !== 'chatting' || !remoteUserId}
                />
              </div>
            </CardFooter>
          </Card>
        )}

        {chatState === 'idle' && chatMode && !showLandingPage && !showActiveChatInterface && (
           <Card className="w-full max-w-md mx-auto shadow-xl bg-card text-card-foreground">
            <CardHeader>
                <CardTitle className="text-xl text-center text-foreground">Start a New Chat</CardTitle>
                <CardDescription className="text-center text-muted-foreground">You ended your previous chat. Start a new one?</CardDescription>
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
               <Button onClick={() => { setChatMode(null); setKeywordsInput(''); }} variant="link" className="mt-2 text-primary">Back to main options</Button>
             </CardContent>
           </Card>
        )}
      </main>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  // const [activeUserCount, setActiveUserCount] = useState<number | null>(null); // Commented out due to Firestore quota issues
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
    setLocalStream(stream);
  }, []);

  const onRemoteStreamCallback = useCallback((stream: MediaStream | null) => {
    console.log(`[ChatApp ${CUID_SHORT}] onRemoteStreamCallback called. Stream: ${stream ? stream.id : 'null'}`);
    setRemoteStream(stream);
  }, [CUID_SHORT]);
  
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
    onConnectionStateChange: useCallback((state) => {
      const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-conn';
      console.log(`[${localCUID}] WebRTC Connection State: ${state}, isStoppingChatRef.current: ${isStoppingChatRef.current}, current chatStateRef: ${chatStateRef.current}`);
      
      if (isStoppingChatRef.current && (state === 'failed' || state === 'disconnected' || state === 'closed')) {
        console.log(`[${localCUID}] onConnectionStateChange: Chat is already stopping or has stopped, ignoring further cleanup/toast from WebRTC state ${state}.`);
        return;
      }

      if (state === 'connected') {
        console.log(`[${localCUID}] WebRTC Connection State became 'connected'. Setting chatState to 'chatting'.`);
        setChatState('chatting'); 
        if(chatStateRef.current !== 'chatting') { 
          toast({ title: "Connected!", description: "You are now chatting with a partner." });
        }
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (!isStoppingChatRef.current && chatStateRef.current !== 'idle' && chatStateRef.current !== 'searching' && chatStateRef.current !== 'closed' ) {
          console.log(`[${localCUID}] onConnectionStateChange: Connection lost/closed (state: ${state}), chatStateRef was ${chatStateRef.current}. Triggering handleStopChat.`);
           if (chatStateRef.current !== 'idle') { 
            toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          }
          handleStopChatRef.current(false); 
        }
      }
    }, [firebaseUser, toast]), 
  });

  const handleStopChat = useCallback(async (initiateNewSearch = false) => {
    const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-stop';
    console.log(`[${localCUID}] handleStopChatReal CALLED. isStopping: ${isStoppingChatRef.current}, current chatState: ${chatStateRef.current}, newSearch: ${initiateNewSearch}, currentRoomId: ${roomIdRef.current}`);
    
    if (isStoppingChatRef.current && !initiateNewSearch) { 
        console.log(`[${localCUID}] handleStopChatReal: Already stopping and not initiating new search. Early exit.`);
        return;
    }
    isStoppingChatRef.current = true;

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
    
    console.log(`[${localCUID}] handleStopChatReal: Calling webrtcCleanup.`);
    webrtcCleanup(); 

    if (firebaseUser) {
      if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          console.log(`[${localCUID}] handleStopChatReal: Firestore cleanup for user ${firebaseUser.uid} in room ${previousRoomId}.`);
          await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid);
      } else if (previousChatState === 'searching' && (!previousRoomId || previousRoomId !== roomIdRef.current )) { 
          // If was searching and didn't get a room, or if the room context changed.
          console.log(`[${localCUID}] handleStopChatReal: Was searching (state: ${previousChatState}, room: ${previousRoomId}), ensuring user status is idle for ${firebaseUser.uid}.`);
          await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      } else if (previousChatState !== 'idle' && previousChatState !== 'closed') { 
         console.log(`[${localCUID}] handleStopChatReal: Not 'chatting', 'connecting', or 'searching', but was ${previousChatState}. Ensuring user status ${firebaseUser.uid} is idle.`);
         await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }
    
    if (initiateNewSearch && firebaseUser && chatMode) { 
      console.log(`[${localCUID}] handleStopChatReal: Initiating new search with mode ${chatMode}.`);
      setTimeout(() => {
          isStoppingChatRef.current = false; 
          console.log(`[${localCUID}] handleStopChatReal: isStoppingChatRef reset for new search.`);
          handleStartSearchRef.current(chatMode); 
      }, 100); 
    } else {
      if (!initiateNewSearch && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          toast({ title: "Chat Ended", description: "The chat session has been closed." });
      }
       if (!initiateNewSearch) { // Only reset chatMode if not doing "Next Chat"
        setChatMode(null);
      }
      isStoppingChatRef.current = false;
      console.log(`[${localCUID}] handleStopChatReal: FINALLY. Setting isStoppingChatRef.current = false.`);
    }
  }, [firebaseUser, toast, webrtcCleanup, chatMode]); 
  
  const handleStartSearch = useCallback(async (selectedChatMode: ChatMode) => {
    const localCUID = firebaseUser?.uid.substring(0,5) || 'anon-search';
    console.log(`[${localCUID}] handleStartSearchReal called with raw keywordsInput: "${keywordsInput}", selectedChatMode: ${selectedChatMode}`);
    
    if (searchTimeoutRef.current) {
        console.log(`[${localCUID}] handleStartSearchReal: Clearing previous search timeout ID: ${searchTimeoutRef.current}.`);
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
        await handleStopChatRef.current(false); // Use ref to ensure latest version
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
        
        const assignedRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, combinedKeywords);
        console.log(`[${localCUID}] handleStartSearchReal: Room created: ${assignedRoomId}. This user (CALLER) sets state to connecting.`);
        setRoomId(assignedRoomId);
        setIsCaller(true);
        setChatState('connecting'); 
        console.log(`[${localCUID}] handleStartSearchReal: CALLER state 'connecting'. Setting up local stream.`);
        await webrtcSetupLocalStreamHookRef.current();
      } else {
        console.log(`[${localCUID}] handleStartSearchReal: No immediate match. Updating self to 'searching'. Normalized Keywords: [${normalizedSearchKeywords.join(',')}]`);
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', normalizedSearchKeywords, null); 
        
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); 
        searchTimeoutRef.current = setTimeout(async () => {
          console.log(`[${localCUID}] Search timeout initiated. Refs at timeout: chatStateRef=${chatStateRef.current}, roomIdRef=${roomIdRef.current}, isStoppingChatRef=${isStoppingChatRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser?.uid) { 
            console.log(`[${localCUID}] Search timeout! No match found for user: ${firebaseUser.uid.substring(0,5)}`);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) { 
                await handleStopChatRef.current(false);
            }
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
        if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }
  }, [firebaseUser, keywordsInput, toast, chatMode]); 

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

  /* Commented out due to Firestore quota issues and being less critical for core chat.
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const count = await FirestoreService.getActiveUserCount();
        setActiveUserCount(count);
      } catch (error) {
        console.error("[ChatApp] Failed to fetch active user count:", error);
      }
    };
    fetchCount(); // Initial fetch
    const intervalId = setInterval(fetchCount, 60000); // Poll every 60 seconds
    return () => clearInterval(intervalId);
  }, []);
  */
  
  useEffect(() => {
    if (firebaseUser?.uid) {
        const currentUid = firebaseUser.uid.substring(0,5); 
        console.log(`[${currentUid}] Setting up onSnapshot listener for self (userStatuses/${firebaseUser.uid}). Initial chatStateRef: ${chatStateRef.current}`);

        const unsubscribe = onSnapshot(doc(db, 'userStatuses', firebaseUser.uid), async (docSnap) => {
            const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
            
            console.log(`[${currentUid}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus), ` PendingWrites: ${docSnap.metadata.hasPendingWrites}`);
            console.log(`[${currentUid}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}, searchTimeoutRef active: ${searchTimeoutRef.current !== null}`);
            
            if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
                if (searchTimeoutRef.current) {
                    console.log(`[${currentUid}] STATUS LISTENER: User status is 'chatting' with roomId ${userStatus.roomId}. Clearing search timeout ID: ${searchTimeoutRef.current}.`);
                    clearTimeout(searchTimeoutRef.current);
                    searchTimeoutRef.current = null;
                }

                const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;
                console.log(`[${currentUid}] STATUS LISTENER (processing 'chatting' status): isNewOrDifferentRoomForMe=${isNewOrDifferentRoomForMe}, client chatStateRef=${chatStateRef.current}, client roomIdRef=${roomIdRef.current}`);

                if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) { 
                  console.log(`[${currentUid}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Matched! Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
                  
                  setRoomId(userStatus.roomId); 
                  setChatState('connecting'); 

                  const roomData = await FirestoreService.getRoomData(userStatus.roomId);
                  if (roomData && roomData.users) {
                    const otherUser = roomData.users.find((uid: string) => uid !== firebaseUser.uid);
                    if (otherUser) {
                       setRemoteUserId(otherUser);
                       setIsCaller(false); 
                       console.log(`[${currentUid}] CALLEE PATH: User is callee (other user: ${otherUser.substring(0,5)}). Setting up local stream.`);
                       await webrtcSetupLocalStreamHookRef.current(); 
                    } else {
                      console.error(`[${currentUid}] ERROR (CALLEE PATH): Other user not found in roomData for room ${userStatus.roomId}. Users: ${roomData.users}. My ID: ${firebaseUser.uid}`);
                      toast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                      if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
                    }
                  } else {
                    console.error(`[${currentUid}] ERROR (CALLEE PATH): Room data not found for room ${userStatus.roomId} or users array missing.`);
                    toast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
                     if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
                  }
                } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) { 
                   console.log(`[${currentUid}] STATUS LISTENER (CALLER PATH): Status 'chatting' for current room ${userStatus.roomId} while I am 'connecting'. Expected for caller.`);
                   if (!localStream) { 
                      console.log(`[${currentUid}] STATUS LISTENER (CALLER PATH): Local stream not yet available, setting it up.`);
                      await webrtcSetupLocalStreamHookRef.current();
                   }
                } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && (chatStateRef.current === 'connecting' || chatStateRef.current === 'chatting')) {
                   console.warn(`[${currentUid}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while already in a process for room ${roomIdRef.current}. Forcing stop of old. Current state: ${chatStateRef.current}`);
                   if (!isStoppingChatRef.current) await handleStopChatRef.current(false); 
                } else if (roomIdRef.current === userStatus.roomId && chatStateRef.current === 'chatting') {
                  console.log(`[${currentUid}] STATUS LISTENER: Already in 'chatting' state for room ${userStatus.roomId}. No state change needed.`);
                } else {
                   console.log(`[${currentUid}] STATUS LISTENER (chatting status): No specific action taken for this 'chatting' update. isNewOrDifferentRoom: ${isNewOrDifferentRoomForMe}, Client ChatState: ${chatStateRef.current}, Client RoomId: ${roomIdRef.current}`);
                }

            } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current && 
                       (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                console.log(`[${currentUid}] STATUS LISTENER: My status in Firestore is 'idle'. Client thought it was in room ${roomIdRef.current} (state: ${chatStateRef.current}). isStoppingChatRef.current: ${isStoppingChatRef.current}`);
                if (!isStoppingChatRef.current) { 
                     console.log(`[${currentUid}] STATUS LISTENER: Not currently stopping locally, proceeding with cleanup due to 'idle' status from Firestore.`);
                     await handleStopChatRef.current(false);
                } else {
                     console.log(`[${currentUid}] STATUS LISTENER: Currently stopping locally (isStoppingChatRef is true), 'idle' status from Firestore likely reflects this. No new cleanup action.`);
                }
            } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
                 console.warn(`[${currentUid}] STATUS LISTENER: My status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
                 if (!isStoppingChatRef.current && chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
            } else {
                console.log(`[${currentUid}] STATUS LISTENER: No specific state-changing action taken for my status: ${userStatus?.status}, my Firestore roomId: ${userStatus?.roomId}. My client refs: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);
            }
        }, (error) => {
            console.error(`[${currentUid}] Error in my user status onSnapshot listener:`, error);
        });
        
        return () => {
            console.log(`[${currentUid}] Unsubscribing from my user status listener (userStatuses/${firebaseUser.uid}).`);
            unsubscribe();
            if (searchTimeoutRef.current) { 
                console.log(`[${currentUid}] Clearing search timeout Ref ${searchTimeoutRef.current} during self-status listener cleanup.`);
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
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, peerConnection]); 
  
  useEffect(() => {
    if (chatState === 'chatting' && remoteUserId) {
      const fetchLocation = async () => {
        try {
          const localCUID = firebaseUser?.uid.substring(0,5) || 'anon';
          console.log(`[${localCUID}] Fetching IP location (server IP demo)...`);
          const response: GetIpLocationOutput = await getIpLocation({}); 
          if (response && response.country) {
            const getFlagEmoji = (countryCode: string | undefined): string => {
              if (!countryCode) return '🏳️'; 
              const ccUpper = countryCode.toUpperCase();
              if (ccUpper.length !== 2 || !/^[A-Z]+$/.test(ccUpper)) return `(${ccUpper})`; 
              return String.fromCodePoint(...ccUpper.split('').map(char => 0x1F1E6 + char.charCodeAt(0) - 'A'.charCodeAt(0)));
            };
            setPartnerLocationDisplay(`${response.country} ${getFlagEmoji(response.countryCode)}`);
          } else {
            setPartnerLocationDisplay("Location: Unknown");
          }
        } catch (error) {
          console.error(`[${CUID_SHORT}] Error fetching IP location:`, error);
          setPartnerLocationDisplay("Location: Error");
        }
      };
      fetchLocation();
    } else {
      setPartnerLocationDisplay(null); 
    }
  }, [chatState, remoteUserId, firebaseUser?.uid, CUID_SHORT]); 

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
                Your safety matters on Chatter Anon. Chats are anonymous by default (we recommend keeping it that way!), and you can end any chat instantly. See our <Link href="/rules" className="underline hover:text-blue-600">Chat Rules</Link> for clear guidelines on how to interact. For more, check our <Link href="/blog" className="underline hover:text-blue-600">Blog</Link> or <Link href="/faq" className="underline hover:text-blue-600">FAQ</Link>.
              </p>
            </CardContent>
          </Card>
        </main>

        <footer className="py-4 text-center text-xs text-muted-foreground border-t border-gray-300">
          ChatterAnon.com &bull;
          <Link href="/rules" className="hover:underline mx-1">Rules</Link> &bull;
          <Link href="/terms" className="hover:underline mx-1">Terms Of Service</Link> &bull;
          <Link href="/privacy" className="hover:underline mx-1">Privacy</Link> &bull;
          <Link href="/blog" className="hover:underline mx-1">Blog</Link> &bull;
          <Link href="/faq" className="hover:underline mx-1">FAQ</Link>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b border-border shadow-sm bg-card flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
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

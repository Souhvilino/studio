
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
  }, [chatState]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const onLocalStreamCallback = useCallback((stream: MediaStream | null) => {
    setLocalStream(stream);
  }, []);

  const onRemoteStreamCallback = useCallback((stream: MediaStream | null) => {
    console.log(`[ChatApp ${firebaseUser?.uid.substring(0,5)}] onRemoteStreamCallback called. Stream: ${stream ? stream.id : 'null'}`);
    setRemoteStream(stream);
  }, [firebaseUser?.uid]);

  const handleStopChatReal = useCallback(async (initiateNewSearch = false) => {
    const currentUid = firebaseUser?.uid || 'unknownUser';
    console.log(`[${currentUid.substring(0,5)}] handleStopChatReal CALLED. isStopping: ${isStoppingChatRef.current}, chatState: ${chatStateRef.current}, newSearch: ${initiateNewSearch}`);

    if (isStoppingChatRef.current) {
      console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: Already stopping. Early exit.`);
      return;
    }
    isStoppingChatRef.current = true;
    
    try {
      if (searchTimeoutRef.current) {
        console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: Clearing search timeout ID: ${searchTimeoutRef.current}.`);
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
      
      console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: Calling webrtcCleanup.`);
      webrtcCleanup(); // Direct call to cleanup from the hook

      if (firebaseUser) {
        console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: prevRoomId=${previousRoomId}, prevChatState=${previousChatState}`);
        if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
          await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid); 
        } else if (previousChatState === 'searching') { 
          console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: Was searching. Updating Firestore status to 'idle'.`);
          await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
        } else if (previousChatState !== 'idle') { 
           await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
        }
      }

      if (initiateNewSearch && firebaseUser) { 
        console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: Initiating new search.`);
        handleStartSearchRef.current();
      } else if (!initiateNewSearch && (previousChatState === 'chatting' || previousChatState === 'connecting')) { 
          toast({ title: "Chat Ended", description: "The chat session has been closed." });
      }
    } catch (error) {
        console.error(`[${currentUid.substring(0,5)}] Error in handleStopChatReal:`, error);
    } finally {
        console.log(`[${currentUid.substring(0,5)}] handleStopChatReal: FINALLY. Setting isStoppingChatRef.current = false.`);
        isStoppingChatRef.current = false;
    }
  }, [firebaseUser, toast /* webrtcCleanup from hook is stable */]); 


  const { 
    startCall: webrtcStartCallOriginal, 
    cleanup: webrtcCleanupOriginal, 
    setupLocalStream: webrtcSetupLocalStreamOriginal, 
    peerConnection,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: onLocalStreamCallback, 
    onRemoteStream: onRemoteStreamCallback,
    onConnectionStateChange: useCallback((state) => { 
      const currentUidShort = firebaseUser?.uid?.substring(0,5) || 'unknown';
      console.log(`[${currentUidShort}] WebRTC Connection State: ${state}, isStoppingChatRef.current: ${isStoppingChatRef.current}, current chatStateRef: ${chatStateRef.current}`);
      
      if (isStoppingChatRef.current && (state === 'failed' || state === 'disconnected' || state === 'closed')) {
        console.log(`[${currentUidShort}] onConnectionStateChange: Chat is already stopping (isStoppingChatRef=true), ignoring further cleanup trigger from WebRTC state ${state}.`);
        return;
      }

      if (state === 'connected') {
        setChatState('chatting');
        toast({ title: "Connected!", description: "You are now chatting with a partner." });
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (chatStateRef.current !== 'idle' && chatStateRef.current !== 'searching' && !isStoppingChatRef.current) { 
          console.log(`[${currentUidShort}] onConnectionStateChange: Connection lost/closed (state: ${state}), chatStateRef was ${chatStateRef.current}. Triggering handleStopChat.`);
          if (state !== 'closed' && chatStateRef.current !== 'idle') { 
            toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          }
          handleStopChatRef.current(false); 
        } else {
           console.log(`[${currentUidShort}] onConnectionStateChange: Connection lost/closed (state: ${state}), but chatStateRef is ${chatStateRef.current} or isStoppingChatRef is true. Not calling handleStopChat from here.`);
        }
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firebaseUser?.uid, toast /* handleStopChatRef is stable via useRef */]),
  });
  const peerConnectionRef = peerConnection; 

  // Stable refs for hook functions
  const webrtcStartCall = useCallback(webrtcStartCallOriginal, [webrtcStartCallOriginal]);
  const webrtcCleanup = useCallback(webrtcCleanupOriginal, [webrtcCleanupOriginal]);
  const webrtcSetupLocalStream = useCallback(webrtcSetupLocalStreamOriginal, [webrtcSetupLocalStreamOriginal]);

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
      toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
      return;
    }
    const CUID_SHORT = currentUid.substring(0,5);
    console.log(`[${CUID_SHORT}] handleStartSearchReal called with raw keywordsInput: "${keywordsInput}"`);

    if (isStoppingChatRef.current) {
      console.log(`[${CUID_SHORT}] handleStartSearchReal: Currently stopping a chat, search aborted.`);
      return;
    }

    if (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting') {
        console.log(`[${CUID_SHORT}] handleStartSearchReal: Already in state ${chatStateRef.current}. Stopping current chat first.`);
        await handleStopChatRef.current(false); // Call ref to the latest handleStopChat
    }
    
    if (searchTimeoutRef.current) {
        console.log(`[${CUID_SHORT}] handleStartSearchReal: Clearing previous search timeout ID: ${searchTimeoutRef.current}.`);
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
    }

    setChatState('searching'); 
    toast({ title: "Searching...", description: "Looking for a chat partner." });
    
    const searchKeywords = keywordsInput.split(',')
      .map(k => k.trim().toLowerCase()) 
      .filter(Boolean);
    console.log(`[${CUID_SHORT}] handleStartSearchReal: Normalized searchKeywords: [${searchKeywords.join(',')}]`);
    
    let matchedUser: UserStatusData | null = null;

    try {
      if (searchKeywords.length > 0) {
          matchedUser = await FirestoreService.findMatch(currentUid, searchKeywords);
          console.log(`[${CUID_SHORT}] handleStartSearchReal: findMatch (with keywords) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)} - Keywords: ${matchedUser.keywords?.join(',')}` : 'null');
      }

      if (!matchedUser) {
          console.log(searchKeywords.length > 0 ? `[${CUID_SHORT}] handleStartSearchReal: No match with keywords, trying to find any searching user.` : `[${CUID_SHORT}] handleStartSearchReal: No keywords provided, trying to find any searching user.`);
          matchedUser = await FirestoreService.findMatch(currentUid, []); 
          console.log(`[${CUID_SHORT}] handleStartSearchReal: findMatch (general) result:`, matchedUser ? `${matchedUser.userId.substring(0,5)} - Keywords: ${matchedUser.keywords?.join(',')}` : 'null');
      }
      
      if (matchedUser && matchedUser.userId !== currentUid) { 
        console.log(`[${CUID_SHORT}] handleStartSearchReal: Match found: ${matchedUser.userId.substring(0,5)}, their normalized keywords:`, matchedUser.keywords?.map(k=>k.toLowerCase()));
        setRemoteUserId(matchedUser.userId);
        
        const combinedKeywords = Array.from(new Set([
            ...searchKeywords, 
            ...(matchedUser.keywords?.map(k => k.toLowerCase()) || [])
        ]));
        const assignedRoomId = await FirestoreService.createRoom(currentUid, matchedUser.userId, combinedKeywords);
        console.log(`[${CUID_SHORT}] handleStartSearchReal: Room created: ${assignedRoomId}. This user (CALLER) sets state to connecting.`);
        setRoomId(assignedRoomId); 
        setIsCaller(true);
        setChatState('connecting'); 
        console.log(`[${CUID_SHORT}] handleStartSearchReal: CALLER state 'connecting'. Setting up local stream.`);
        await webrtcSetupLocalStream(); 
      } else { 
        console.log(`[${CUID_SHORT}] handleStartSearchReal: No immediate match. Updating self to 'searching'. Normalized Keywords: [${searchKeywords.join(',')}]`);
        await FirestoreService.updateUserStatus(currentUid, 'searching', searchKeywords, null); 

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); 
        searchTimeoutRef.current = setTimeout(async () => {
          const uidForTimeoutShort = firebaseUser?.uid?.substring(0,5) || 'unknownInTimeout';
          console.log(`[${uidForTimeoutShort}] Search timeout initiated. Refs at timeout: chatStateRef=${chatStateRef.current}, roomIdRef=${roomIdRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser?.uid) { 
            console.log(`[${uidForTimeoutShort}] Search timeout! No match found for user: ${firebaseUser.uid.substring(0,5)}. Current chatState: ${chatStateRef.current}`);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            await handleStopChatRef.current(false); 
          } else {
            console.log(`[${uidForTimeoutShort}] Search timeout condition not met or already resolved. chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          }
          searchTimeoutRef.current = null;
        }, 30000); 
        console.log(`[${CUID_SHORT}] handleStartSearchReal: Set search timeout ID: ${searchTimeoutRef.current}`);
      }
    } catch (error) {
      console.error(`[${CUID_SHORT}] Error in handleStartSearchReal:`, error);
      toast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      if (chatStateRef.current !== 'idle') {
        setChatState('idle');
        if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    }
  }, [firebaseUser, keywordsInput, toast, webrtcSetupLocalStream]);

  const handleStartSearchRef = useRef(handleStartSearchReal);
  const handleStopChatRef = useRef(handleStopChatReal);
 
  useEffect(() => {
    handleStartSearchRef.current = handleStartSearchReal;
  }, [handleStartSearchReal]);

  useEffect(() => {
    handleStopChatRef.current = handleStopChatReal;
  }, [handleStopChatReal]);
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      const CUID_SHORT = firebaseUser.uid.substring(0,5);
      console.log(`[${CUID_SHORT}] Attempting to start WebRTC call. Room: ${roomId}, Is Caller: ${isCaller}, PC State: ${peerConnectionRef.current?.signalingState}, localStream tracks: ${localStream?.getTracks().length}`);
      if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === 'closed') {
         console.log(`[${CUID_SHORT}] Creating new PeerConnection for startCall (isCaller: ${isCaller}).`);
         webrtcStartCall(isCaller); 
      } else if (['stable', 'have-local-offer', 'have-remote-offer'].includes(peerConnectionRef.current.signalingState)) {
        console.log(`[${CUID_SHORT}] PC exists (state: ${peerConnectionRef.current.signalingState}), re-initiating call process (isCaller: ${isCaller}).`);
        webrtcStartCall(isCaller); 
      } else {
        console.log(`[${CUID_SHORT}] PC exists but not in a state to start/restart call, current state: ${peerConnectionRef.current.signalingState}. Waiting.`);
      }
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, webrtcStartCall, peerConnectionRef]);
  
  useEffect(() => {
    if (firebaseUser?.uid) {
      const currentUid = firebaseUser.uid;
      const CUID_SHORT = currentUid.substring(0,5);
      const userStatusDocRef = doc(db, 'userStatuses', currentUid);
      console.log(`[${CUID_SHORT}] Setting up onSnapshot listener for self (userStatuses/${currentUid}). Initial chatStateRef: ${chatStateRef.current}`);

      const unsubscribe = onSnapshot(userStatusDocRef, async (docSnap) => {
        const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
        
        console.log(`[${CUID_SHORT}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus), ` PendingWrites: ${docSnap.metadata.hasPendingWrites}`);
        console.log(`[${CUID_SHORT}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}, searchTimeoutRef active: ${searchTimeoutRef.current !== null}`);
        
        if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
          if (searchTimeoutRef.current) {
            console.log(`[${CUID_SHORT}] STATUS LISTENER: User status is 'chatting' with roomId ${userStatus.roomId}. Clearing search timeout ID: ${searchTimeoutRef.current}.`);
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
          }

          const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;
          console.log(`[${CUID_SHORT}] STATUS LISTENER (processing 'chatting' status): isNewOrDifferentRoomForMe=${isNewOrDifferentRoomForMe}, client chatStateRef=${chatStateRef.current}, client roomIdRef=${roomIdRef.current}`);
          
          if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) { 
            console.log(`[${CUID_SHORT}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Matched! Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
            
            setRoomId(userStatus.roomId); 
            setChatState('connecting'); 

            const roomData = await FirestoreService.getRoomData(userStatus.roomId);
            if (roomData && roomData.users) {
              const otherUser = roomData.users.find((uid: string) => uid !== currentUid);
              if (otherUser) {
                 setRemoteUserId(otherUser);
                 setIsCaller(false); 
                 console.log(`[${CUID_SHORT}] CALLEE PATH: User is callee (other user: ${otherUser.substring(0,5)}). Setting up local stream.`);
                 await webrtcSetupLocalStream(); 
              } else {
                console.error(`[${CUID_SHORT}] ERROR (CALLEE PATH): Other user not found in roomData for room ${userStatus.roomId}. Users: ${JSON.stringify(roomData.users)}. My ID: ${currentUid}`);
                toast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
              }
            } else {
              console.error(`[${CUID_SHORT}] ERROR (CALLEE PATH): Room data not found for room ${userStatus.roomId} or users array missing.`);
              toast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
              if (chatStateRef.current !== 'idle') await handleStopChatRef.current(false);
            }
          } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) { 
             console.log(`[${CUID_SHORT}] STATUS LISTENER (CALLER PATH CONFIRMATION): Status 'chatting' for current room ${userStatus.roomId} while I am 'connecting'. Expected for caller.`);
             if (!localStream) { 
                console.log(`[${CUID_SHORT}] STATUS LISTENER (CALLER PATH): Local stream not yet available, setting it up.`);
                await webrtcSetupLocalStream();
             }
          } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && (chatStateRef.current === 'connecting' || chatStateRef.current === 'chatting')) {
             console.warn(`[${CUID_SHORT}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while already in a process for room ${roomIdRef.current}. Forcing stop of old. Current state: ${chatStateRef.current}`);
             await handleStopChatRef.current(false); 
          } else if (roomIdRef.current === userStatus.roomId && chatStateRef.current === 'chatting') {
             console.log(`[${CUID_SHORT}] STATUS LISTENER: Already in 'chatting' state for room ${userStatus.roomId}. No state change needed.`);
          } else {
             console.log(`[${CUID_SHORT}] STATUS LISTENER (chatting status): No specific action taken for this 'chatting' update. isNewOrDifferentRoom: ${isNewOrDifferentRoomForMe}, Client ChatState: ${chatStateRef.current}, Client RoomId: ${roomIdRef.current}, Firestore RoomId: ${userStatus.roomId}`);
          }

        } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
          console.log(`[${CUID_SHORT}] STATUS LISTENER: My status in Firestore is 'idle', but client was in room ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
          if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) { 
             await handleStopChatRef.current(false); 
          }
        } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
            console.warn(`[${CUID_SHORT}] STATUS LISTENER: My status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current} (state: ${chatStateRef.current}). Cleaning up client-side.`);
            if (chatStateRef.current !== 'idle' && !isStoppingChatRef.current) await handleStopChatRef.current(false);
        } else {
          console.log(`[${CUID_SHORT}] STATUS LISTENER: No specific state-changing action taken for my status: ${userStatus?.status}, my Firestore roomId: ${userStatus?.roomId}. Client refs: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);
        }
      }, (error) => {
        console.error(`[${CUID_SHORT}] Error in my user status onSnapshot listener:`, error);
      });
      
      return () => {
        console.log(`[${CUID_SHORT}] Unsubscribing from my user status listener (userStatuses/${currentUid}).`);
        unsubscribe();
        if (searchTimeoutRef.current) { 
            console.log(`[${CUID_SHORT}] Clearing search timeout Ref ${searchTimeoutRef.current} during self-status listener cleanup.`);
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, toast]); // Dependencies kept minimal for stability


  const handleSendMessage = async () => {
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

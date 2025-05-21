
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { VideoArea } from './video-area';
import { MessageItem } from './message-item';
import { ReportDialog } from './report-dialog';
import { useFirebaseAuth } from './firebase-auth-provider';
import type { ChatMessage, ChatState, ReportData, UserStatusData } from '@/types';
import { Send, Loader2, MessageSquare, Search, XCircle, Languages, RotateCcw } from 'lucide-react';
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

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatStateRef = useRef(chatState);
  const roomIdRef = useRef(roomId);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  useEffect(() => {
    chatStateRef.current = chatState;
    roomIdRef.current = roomId;
    // console.log(`[${firebaseUser?.uid}] Refs updated: chatStateRef=${chatStateRef.current}, roomIdRef=${roomIdRef.current}`);
  }, [chatState, roomId, firebaseUser?.uid]);

  const { 
    startCall: webrtcStartCall, 
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStreamHook, 
    peerConnection,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: setLocalStream, 
    onRemoteStream: setRemoteStream,
    onConnectionStateChange: (state) => {
      console.log(`[${firebaseUser?.uid}] WebRTC Connection State: ${state}`);
      if (state === 'connected') {
        setChatState('chatting');
        toast({ title: "Connected!", description: "You are now chatting with a partner." });
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (chatStateRef.current !== 'idle') { 
          toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          handleStopChat(false); 
        }
      }
    }
  });
  const peerConnectionRef = peerConnection?.current; 

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


  const handleStartSearch = async () => {
    if (!firebaseUser) {
      toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
      return;
    }
    if (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting') {
        console.log(`[${firebaseUser.uid}] handleStartSearch: Already chatting or connecting, stopping current chat first.`);
        await handleStopChat(false); 
    }
    
    if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
        console.log(`[${firebaseUser.uid}] Cleared previous search timeout before starting new search.`);
    }

    console.log(`[${firebaseUser.uid}] handleStartSearch called`);
    setChatState('searching'); 
    toast({ title: "Searching...", description: "Looking for a chat partner." });
    const searchKeywords = keywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    
    let matchedUser: UserStatusData | null = null;
    let assignedRoomId: string | null = null;

    try {
      if (searchKeywords.length > 0) {
          console.log(`[${firebaseUser.uid}] Attempting match with keywords:`, searchKeywords);
          matchedUser = await FirestoreService.findMatch(firebaseUser.uid, searchKeywords);
      }

      if (!matchedUser) {
          console.log(searchKeywords.length > 0 ? `[${firebaseUser.uid}] No match with keywords, trying to find any searching user.` : `[${firebaseUser.uid}] No keywords provided, trying to find any searching user.`);
          matchedUser = await FirestoreService.findMatch(firebaseUser.uid); 
      }
      
      if (matchedUser && matchedUser.userId !== firebaseUser.uid) { // Match Found!
        console.log(`[${firebaseUser.uid}] Match found: ${matchedUser.userId}, with keywords:`, matchedUser.keywords);
        setRemoteUserId(matchedUser.userId);
        
        const roomKeywords = Array.from(new Set([...searchKeywords, ...(matchedUser.keywords || [])]));
        assignedRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, roomKeywords);
        console.log(`[${firebaseUser.uid}] Room created: ${assignedRoomId}`);
        setRoomId(assignedRoomId); 
        setIsCaller(true);
        
        setChatState('connecting'); 
        console.log(`[${firebaseUser.uid}] Chat state set to connecting. Setting up local stream.`);
        await webrtcSetupLocalStreamHook(); 
      } else { // No immediate match found
        console.log(`[${firebaseUser.uid}] No immediate match found. Updating self to 'searching' to be discoverable with keywords:`, searchKeywords);
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', searchKeywords, null); // Set self to searching

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(async () => {
          console.log(`[${firebaseUser.uid}] Search timeout initiated. Current chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser) {
            console.log(`[${firebaseUser.uid}] Search timeout! No match found for user: ${firebaseUser.uid}`);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            if (chatStateRef.current === 'searching') { 
                setChatState('idle');
                await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
            }
          } else {
            console.log(`[${firebaseUser.uid}] Search timeout condition not met. chatStateRef: ${chatStateRef.current}, roomIdRef: ${roomIdRef.current}`);
          }
          searchTimeoutRef.current = null;
        }, 30000); 
      }
    } catch (error) {
      console.error(`[${firebaseUser.uid}] Error during matching or room creation:`, error);
      toast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      setChatState('idle');
      if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
    }
  };
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      console.log(`[${firebaseUser.uid}] Attempting to start WebRTC call. Is Caller: ${isCaller}, Signaling State: ${peerConnectionRef?.signalingState}`);
      if (!peerConnectionRef || peerConnectionRef.signalingState === 'closed') {
         console.log(`[${firebaseUser.uid}] Creating new PeerConnection and starting call.`);
         webrtcStartCall(isCaller); 
      } else if (isCaller && peerConnectionRef.signalingState === 'stable') {
        console.log(`[${firebaseUser.uid}] Caller, stable, localStream ready. Re-affirming call as caller.`);
        webrtcStartCall(true); 
      } else if (!isCaller && peerConnectionRef.signalingState === 'stable') {
        console.log(`[${firebaseUser.uid}] Callee, stable, localStream ready. Waiting for offer or ensuring connection.`);
        webrtcStartCall(false);
      }
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, webrtcStartCall, peerConnectionRef]);


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

  const handleStopChat = useCallback(async (initiateNewSearch = false) => {
    const currentUid = firebaseUser?.uid || 'unknownUser';
    console.log(`[${currentUid}] handleStopChat called. Current roomIdRef: ${roomIdRef.current}, Current chatStateRef: ${chatStateRef.current}, initiateNewSearch: ${initiateNewSearch}`);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
      console.log(`[${currentUid}] Cleared search timeout in handleStopChat.`);
    }

    const previousRoomId = roomIdRef.current; 
    const previousChatState = chatStateRef.current;

    setRoomId(null);
    setRemoteUserId(null);
    setMessages([]);
    setIsCaller(false); 
    setChatState('idle'); 
    
    webrtcCleanup(); 

    if (firebaseUser) {
      if (previousRoomId && (previousChatState === 'chatting' || previousChatState === 'connecting')) {
        console.log(`[${firebaseUser.uid}] Cleaning up room in Firestore: ${previousRoomId}`);
        await FirestoreService.cleanupRoom(previousRoomId, firebaseUser.uid); 
      } else {
        console.log(`[${firebaseUser.uid}] No room ID to clean, or not in a chat. Ensuring user status is idle for user: ${firebaseUser.uid}`);
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
      }
    } else {
        console.warn(`[handleStopChat] Firebase user not available, cannot update Firestore status.`);
    }

    if (initiateNewSearch && firebaseUser) { 
      console.log(`[${firebaseUser.uid}] Initiating new search after stopping chat.`);
      handleStartSearch(); 
    } else if (!initiateNewSearch) {
        toast({ title: "Chat Ended", description: "The chat session has been closed." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, webrtcCleanup, toast]); 
  
 useEffect(() => {
    if (firebaseUser?.uid) {
      const userStatusDocRef = doc(db, 'userStatuses', firebaseUser.uid);
      const unsubscribe = onSnapshot(userStatusDocRef, async (docSnap) => {
        const userStatus = docSnap.exists() ? docSnap.data() as UserStatusData : null;
        const currentUid = firebaseUser.uid; 

        console.log(`[${currentUid}] RAW USER STATUS UPDATE RECEIVED:`, JSON.stringify(userStatus));
        console.log(`[${currentUid}] Current refs BEFORE processing status: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);

        if (userStatus && userStatus.status === 'chatting' && userStatus.roomId) {
           // This user is being put into a 'chatting' state by Firestore.
           // This typically means they are the CALLEE or it's a confirmation for the CALLER.
           
           const isNewOrDifferentRoomForMe = !roomIdRef.current || roomIdRef.current !== userStatus.roomId;

           // If Firestore says I'm 'chatting' in a room, and this is a new room assignment for me (or I was searching/idle)
           if (isNewOrDifferentRoomForMe && (chatStateRef.current === 'searching' || chatStateRef.current === 'idle')) {
            console.log(`[${currentUid}] STATUS LISTENER (CALLEE PATH from ${chatStateRef.current}): Transitioning to 'connecting'. New Room: ${userStatus.roomId}`);
            
            if (searchTimeoutRef.current) { // Clear search timeout as we are being matched
              clearTimeout(searchTimeoutRef.current);
              searchTimeoutRef.current = null;
              console.log(`[${currentUid}] Cleared search timeout because matched as callee into room ${userStatus.roomId}.`);
            }
            
            setRoomId(userStatus.roomId); // This will update roomIdRef via its own useEffect
            setChatState('connecting'); // This will update chatStateRef via its own useEffect

            const roomData = await FirestoreService.getRoomData(userStatus.roomId);
            if (roomData && roomData.users) {
              console.log(`[${currentUid}] Fetched roomData for room ${userStatus.roomId}:`, JSON.stringify(roomData));
              const otherUser = roomData.users.find((uid: string) => uid !== currentUid);
              if (otherUser) {
                 console.log(`[${currentUid}] Found other user: ${otherUser}. Setting remoteUserId and isCaller=false.`);
                 setRemoteUserId(otherUser);
                 setIsCaller(false); 
                 console.log(`[${currentUid}] User is callee, state is 'connecting'. Setting up local stream.`);
                 await webrtcSetupLocalStreamHook(); 
              } else {
                console.error(`[${currentUid}] ERROR (CALLEE): Other user not found in roomData for room ${userStatus.roomId}. Users: ${roomData.users}. My ID: ${currentUid}`);
                toast({ title: "Matching Error", description: "Could not identify chat partner.", variant: "destructive" });
                if (chatStateRef.current !== 'idle') await handleStopChat(false);
              }
            } else {
              console.error(`[${currentUid}] ERROR (CALLEE): Room data not found for room ${userStatus.roomId} or users array missing.`);
              toast({ title: "Room Error", description: "Could not retrieve room information.", variant: "destructive" });
              if (chatStateRef.current !== 'idle') await handleStopChat(false);
            }
          } else if (chatStateRef.current === 'connecting' && roomIdRef.current === userStatus.roomId) {
             // CALLER PATH (confirmation) or CALLEE already processing this room.
             console.log(`[${currentUid}] STATUS LISTENER: Status 'chatting' for current room ${userStatus.roomId} while 'connecting'. This is expected for caller or already handled for callee.`);
             if (searchTimeoutRef.current) { // Also clear search timeout for caller if it was somehow active
                clearTimeout(searchTimeoutRef.current);
                searchTimeoutRef.current = null;
                console.log(`[${currentUid}] Cleared search timeout for caller in 'connecting' state for room ${userStatus.roomId}.`);
             }
          } else if (isNewOrDifferentRoomForMe && userStatus.status === 'chatting' && chatStateRef.current === 'connecting') {
             // Rapid "Next Chat" scenario: was connecting to old room, now assigned to new one.
             console.warn(`[${currentUid}] STATUS LISTENER: Assigned to new chat room ${userStatus.roomId} while 'connecting' to old room ${roomIdRef.current}. Forcing stop of old, then will re-process new.`);
             await handleStopChat(false); // This will set state to 'idle'. The onSnapshot should fire again for the new room.
          } else {
             console.log(`[${currentUid}] STATUS LISTENER: Received 'chatting' status for room ${userStatus.roomId}, but conditions not met for main callee/caller paths. isNewOrDifferentRoom: ${isNewOrDifferentRoomForMe}, ChatState: ${chatStateRef.current}, RoomId: ${roomIdRef.current}`);
          }

        } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
          console.log(`[${currentUid}] STATUS LISTENER: User status in Firestore is 'idle', but client was in room ${roomIdRef.current} (${chatStateRef.current}). Cleaning up client-side.`);
          if (chatStateRef.current !== 'idle') { 
             await handleStopChat(false);
          }
        } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && (chatStateRef.current === 'chatting' || chatStateRef.current === 'connecting')) {
            console.warn(`[${currentUid}] STATUS LISTENER: User status is 'searching' (Firestore) but client believes it's in a room/connecting to ${roomIdRef.current}. Discrepancy (likely other user stopped). Cleaning up.`);
            if (chatStateRef.current !== 'idle') await handleStopChat(false);
        } else {
          console.log(`[${currentUid}] STATUS LISTENER: No specific action taken for status: ${userStatus?.status}, roomId: ${userStatus?.roomId}. My refs: roomIdRef=${roomIdRef.current}, chatStateRef=${chatStateRef.current}`);
        }
      }, (error) => {
        console.error(`[${firebaseUser?.uid}] Error in user status listener:`, error);
      });
      
      return () => {
        console.log(`[${firebaseUser?.uid}] Unsubscribing from user status listener for: ${firebaseUser.uid}`);
        unsubscribe();
        if (searchTimeoutRef.current) { // Ensure cleanup on unmount/re-subscribe
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]); // Kept minimal dependencies to avoid re-subscribing too often. handleStopChat and webrtcSetupLocalStreamHook are stable.


  if (!firebaseUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }

  const isInteractionDisabled = chatState === 'searching' || chatState === 'connecting';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b border-border shadow-sm bg-card">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {(chatState === 'idle' || chatState === 'searching' || chatState === 'error') && !(chatState === 'connecting' || chatState === 'chatting') && (
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
               <Button onClick={handleStartSearch} disabled={isInteractionDisabled} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {chatState === 'searching' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                {chatState === 'searching' ? 'Searching...' : 'Start Chat'}
              </Button>
            </CardFooter>
          </Card>
        )}

        {(chatState === 'chatting' || chatState === 'connecting' || localStream || remoteStream ) && (
          <VideoArea localStream={localStream} remoteStream={remoteStream} isChatting={chatState === 'chatting'} />
        )}

        {(chatState === 'chatting' || chatState === 'connecting') && (
          <Card className="flex-1 flex flex-col shadow-lg overflow-hidden">
            <CardHeader className="p-4 border-b">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg flex items-center">
                  <MessageSquare className="mr-2 h-5 w-5 text-primary" /> 
                  {chatState === 'connecting' ? 'Connecting...' : chatState === 'chatting' ? 'Chatting' : 'Chat Room'}
                </CardTitle>
                <div className="flex gap-2">
                   <Button onClick={() => handleStopChat(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10" disabled={chatStateRef.current === 'searching'}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChat(false)} variant="destructive" size="sm" disabled={chatStateRef.current === 'searching'}>
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
        {chatState === 'idle' && !localStream && !remoteStream && !(chatState === 'connecting' || chatState === 'chatting') && (
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
    

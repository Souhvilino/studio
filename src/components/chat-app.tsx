
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
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';


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
  // const [lastMessageDoc, setLastMessageDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null); // For pagination if implemented

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatStateRef = useRef(chatState);
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    chatStateRef.current = chatState;
    roomIdRef.current = roomId;
  }, [chatState, roomId]);

  const { 
    startCall: webrtcStartCall, 
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStreamHook, 
    peerConnection,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: setLocalStream, // This updates ChatApp's localStream state
    onRemoteStream: setRemoteStream,
    onConnectionStateChange: (state) => {
      console.log("WebRTC Connection State:", state);
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
      const unsubscribe = FirestoreService.listenForMessages(roomId, (newMessages, newLastDoc) => {
        setMessages(prevMessages => {
          const existingMessageIds = new Set(prevMessages.map(m => m.id));
          const uniqueNewMessages = newMessages.filter(nm => !existingMessageIds.has(nm.id));
          
          return [...prevMessages, ...uniqueNewMessages]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(msg => ({...msg, isLocalUser: msg.userId === firebaseUser.uid }));
        });
        // if (newLastDoc) {
        //   setLastMessageDoc(newLastDoc); 
        // }
      });
      return () => unsubscribe();
    }
  }, [roomId, chatState, firebaseUser?.uid]);


  const handleStartSearch = async () => {
    if (!firebaseUser) {
      toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
      return;
    }
    if (chatState === 'chatting' || chatState === 'connecting') {
        await handleStopChat(false);
    }

    console.log("handleStartSearch called");
    setChatState('searching');
    toast({ title: "Searching...", description: "Looking for a chat partner." });
    const searchKeywords = keywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    
    let matchedUser: UserStatusData | null = null;

    try {
      if (searchKeywords.length > 0) {
          console.log("Attempting match with keywords:", searchKeywords);
          matchedUser = await FirestoreService.findMatch(firebaseUser.uid, searchKeywords);
      }

      if (!matchedUser) {
          console.log(searchKeywords.length > 0 ? "No match with keywords, trying to find any searching user." : "No keywords provided, trying to find any searching user.");
          matchedUser = await FirestoreService.findMatch(firebaseUser.uid); 
      }
      
      // Update user status to searching with their keywords (if any)
      // This makes them discoverable if they didn't find a match immediately.
      // If they did find a match, their status will be updated to 'chatting' shortly by createRoom.
      console.log("Updating current user status to 'searching' with keywords:", searchKeywords);
      await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', searchKeywords, null); // Explicitly null for roomId

      if (matchedUser && matchedUser.userId !== firebaseUser.uid) {
        console.log("Match found:", matchedUser.userId, "with keywords:", matchedUser.keywords);
        setRemoteUserId(matchedUser.userId);
        
        const roomKeywords = Array.from(new Set([...searchKeywords, ...(matchedUser.keywords || [])]));
        const newRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, roomKeywords);
        console.log("Room created:", newRoomId);
        setRoomId(newRoomId);
        setIsCaller(true);
        
        setChatState('connecting');
        console.log("Chat state set to connecting. Setting up local stream.");
        await webrtcSetupLocalStreamHook(); 
      } else {
        console.log("No immediate match found. User is now discoverable with keywords:", searchKeywords);
        setTimeout(async () => {
          console.log("Search timeout initiated. Current chatState:", chatStateRef.current, "roomId:", roomIdRef.current);
          if (chatStateRef.current === 'searching' && !roomIdRef.current && firebaseUser) {
            console.log("Search timeout! No match found for user:", firebaseUser.uid);
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            setChatState('idle');
            await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
          } else {
            console.log("Search timeout condition not met or user already matched/connecting.");
          }
        }, 30000); // 30 seconds timeout for search
      }
    } catch (error) {
      console.error("Error during matching or room creation:", error);
      toast({ title: "Search Error", description: "Could not complete search. Please try again.", variant: "destructive"});
      setChatState('idle');
      if (firebaseUser) await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
    }
  };
  
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      console.log("Attempting to start WebRTC call. Is Caller:", isCaller, "Signaling State:", peerConnectionRef?.signalingState);
      if (!peerConnectionRef || peerConnectionRef.signalingState === 'closed') {
         console.log("Creating new PeerConnection and starting call.");
         webrtcStartCall(isCaller); 
      } else if (isCaller && peerConnectionRef.signalingState === 'stable') {
        console.log("Caller, stable, localStream ready. Re-affirming call as caller.");
        webrtcStartCall(true); 
      } else if (!isCaller && peerConnectionRef.signalingState === 'stable') {
        console.log("Callee, stable, localStream ready. Waiting for offer or ensuring connection.");
        // Callee typically waits for offer, but if already stable and connecting, ensure startCall is invoked.
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
        sourceLanguage: "auto", // Or detect language if needed
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
    console.log("handleStopChat called. Current roomId:", roomIdRef.current, " Current chatState:", chatStateRef.current);
    toast({ title: "Chat Ended", description: "The chat session has been closed." });
    
    webrtcCleanup(); 

    if (roomIdRef.current) {
      console.log("Cleaning up room in Firestore:", roomIdRef.current);
      await FirestoreService.cleanupRoom(roomIdRef.current); 
    } else if (firebaseUser) {
      console.log("No room ID, ensuring user status is idle for user:", firebaseUser.uid);
      await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', [], null);
    }

    setRoomId(null);
    setRemoteUserId(null);
    setMessages([]);
    setIsCaller(false); 
    setChatState('idle'); 

    if (initiateNewSearch) {
      console.log("Initiating new search after stopping chat.");
      handleStartSearch(); 
    }
  }, [firebaseUser, webrtcCleanup, toast]); // Removed handleStartSearch from deps to avoid loop, it's called conditionally
  
  useEffect(() => {
    if (firebaseUser) {
      const unsub = FirestoreService.listenToUserStatus(firebaseUser.uid, async (userStatus) => {
        console.log("User status listener fired. New status for", firebaseUser.uid, ":", userStatus);
        if (userStatus && userStatus.status === 'chatting' && userStatus.roomId && !roomIdRef.current) {
          console.log("Detected incoming call/match. Current client roomId is null. Joining room:", userStatus.roomId);
          const currentRoomId = userStatus.roomId;
          setRoomId(currentRoomId);
          const roomData = await FirestoreService.getRoomData(currentRoomId);
          if (roomData && roomData.users) {
            const otherUser = roomData.users.find((uid: string) => uid !== firebaseUser.uid);
            if (otherUser) {
               setRemoteUserId(otherUser);
               setIsCaller(false); 
               setChatState('connecting');
               console.log("User is callee, state set to connecting. Setting up local stream.");
               await webrtcSetupLocalStreamHook(); 
            } else {
              console.error("Room data found, but other user ID missing. Room users:", roomData.users, "Current user:", firebaseUser.uid);
              handleStopChat(false); 
            }
          } else {
            console.error("Room data not found for incoming call, or users array missing. Room ID:", currentRoomId);
            handleStopChat(false); 
          }
        } else if (userStatus && userStatus.status === 'idle' && roomIdRef.current) {
          if (chatStateRef.current !== 'idle') { 
             console.log("User status in Firestore is 'idle', but client was in a room (roomId:", roomIdRef.current,"). Cleaning up client-side.");
             handleStopChat(false);
          }
        } else if (userStatus && userStatus.status === 'searching' && roomIdRef.current && chatStateRef.current === 'chatting') {
            // This case might occur if something went wrong during cleanup on the other side
            // and this user's status reverted to searching while they thought they were in a chat.
            console.warn("User status is 'searching' but client believes it's in a room. Discrepancy. Cleaning up.");
            handleStopChat(false);
        }
      });
      return () => {
        console.log("Unsubscribing from user status listener for:", firebaseUser.uid);
        unsub();
      };
    }
  }, [firebaseUser, handleStopChat, webrtcSetupLocalStreamHook]); // roomId and chatState refs are used internally


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
                  {chatState === 'connecting' ? 'Connecting...' : 'Chatting'}
                </CardTitle>
                <div className="flex gap-2">
                   <Button onClick={() => handleStopChat(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10" disabled={chatState === 'searching'}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChat(false)} variant="destructive" size="sm" disabled={chatState === 'searching'}>
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
    


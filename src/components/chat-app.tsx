
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
  const [lastMessageDoc, setLastMessageDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);


  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { 
    startCall: webrtcStartCall, 
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStream, 
    peerConnection,
  } = useWebRTCSignaling({
    roomId,
    currentUserId: firebaseUser?.uid || null,
    remoteUserId,
    onLocalStream: setLocalStream,
    onRemoteStream: setRemoteStream,
    onConnectionStateChange: (state) => {
      console.log("WebRTC Connection State:", state);
      if (state === 'connected') {
        setChatState('chatting');
        toast({ title: "Connected!", description: "You are now chatting with a partner." });
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        if (chatState !== 'idle') { // Avoid multiple toasts if already stopped
          toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
          handleStopChat(false); 
        }
      }
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Message listener
  useEffect(() => {
    if (roomId && chatState === 'chatting' && firebaseUser?.uid) {
      const unsubscribe = FirestoreService.listenForMessages(roomId, (newMessages, newLastDoc) => {
        setMessages(prevMessages => {
          // Filter out duplicates and merge
          const existingMessageIds = new Set(prevMessages.map(m => m.id));
          const uniqueNewMessages = newMessages.filter(nm => !existingMessageIds.has(nm.id));
          
          return [...prevMessages, ...uniqueNewMessages]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(msg => ({...msg, isLocalUser: msg.userId === firebaseUser.uid }));
        });
        if (newLastDoc) {
          // setLastMessageDoc(newLastDoc); // For pagination, if implemented
        }
      });
      return () => unsubscribe();
    }
  }, [roomId, chatState, firebaseUser?.uid]);


  const handleStartSearch = async () => {
    if (!firebaseUser) {
      toast({ title: "Error", description: "You must be signed in to chat.", variant: "destructive" });
      return;
    }
    // Clean up any existing connections first
    if (chatState === 'chatting' || chatState === 'connecting') {
        await handleStopChat(false); // Clean up before starting new search
    }


    setChatState('searching');
    toast({ title: "Searching...", description: "Looking for a chat partner." });
    const searchKeywords = keywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', searchKeywords);
    
    try {
      const matchedUser = await FirestoreService.findMatch(firebaseUser.uid, searchKeywords);

      if (matchedUser && matchedUser.userId !== firebaseUser.uid) {
        setRemoteUserId(matchedUser.userId);
        const newRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, searchKeywords);
        setRoomId(newRoomId);
        setIsCaller(true);
        
        // FirestoreService.updateUserStatus will be called by createRoom for both users.
        setChatState('connecting');
        await webrtcSetupLocalStream(); 
      } else {
        console.log("No immediate match found. User is now discoverable.");
        // Set a timeout to stop searching if no match is found by another user
        setTimeout(async () => {
          if(chatState === 'searching' && !roomId && firebaseUser) { // Check !roomId and firebaseUser again
            toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
            setChatState('idle');
            await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle');
          }
        }, 20000); // 20 seconds timeout for search
      }
    } catch (error) {
      console.error("Error during matching or room creation:", error);
      toast({ title: "Search Error", description: "Could not find a match. Please try again.", variant: "destructive"});
      setChatState('idle');
      await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle');
    }
  };
  
  // Effect to initiate WebRTC call once room and users are set and local stream is ready
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      // Check if peerConnection already exists and is in a stable state to avoid re-creating
      if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === 'closed') {
         webrtcStartCall(isCaller);
      } else if (isCaller && peerConnectionRef.current.signalingState === 'stable') {
        // If caller and stable, might need to re-negotiate if this effect runs again
        // This can happen if localStream becomes available after initial setup
        console.log("Caller, stable, localStream ready. Triggering negotiation via startCall if needed.");
        webrtcStartCall(true); // Re-affirm call as caller
      }
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, webrtcStartCall]);
  const peerConnectionRef = peerConnection?.current; // Get the ref from the hook


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
      // Decide if to send or block based on policy
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

  const handleStopChat = async (initiateNewSearch = false) => {
    toast({ title: "Chat Ended", description: "The chat session has been closed." });
    
    webrtcCleanup(); // Cleans up WebRTC (streams, peer connection)

    if (roomId) {
      await FirestoreService.cleanupRoom(roomId); // Updates room status, user statuses
    } else if (firebaseUser) {
      // If no room ID but user exists, ensure their status is idle
      await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle', undefined, null);
    }

    setRoomId(null);
    setRemoteUserId(null);
    setMessages([]);
    // localStream and remoteStream are managed by webrtcCleanup via onLocalStream/onRemoteStream callbacks
    setIsCaller(false); // Reset caller state
    setChatState('idle'); // Set state to idle first

    if (initiateNewSearch) {
      handleStartSearch(); // Then initiate search if requested
    }
  };

  const handleSubmitReport = async (reportData: ReportData) => {
    try {
      await FirestoreService.createReport(reportData);
      // No re-throw needed, ReportDialog handles its own success/error toasts.
    } catch (error) {
      console.error("Failed to submit report via ChatApp:", error);
      // Let ReportDialog handle error toast
      throw error;
    }
  };
  
  // Listener for current user's status (e.g., if they become a callee)
  useEffect(() => {
    if (firebaseUser) {
      const unsub = FirestoreService.listenToUserStatus(firebaseUser.uid, async (userStatus) => {
        if (userStatus && userStatus.status === 'chatting' && userStatus.roomId && !roomId) {
          // User has been matched by someone else
          console.log("Detected incoming call/match. Joining room:", userStatus.roomId);
          const currentRoomId = userStatus.roomId;
          setRoomId(currentRoomId);
          const roomData = await FirestoreService.getRoomData(currentRoomId);
          if (roomData && roomData.users) {
            const otherUser = roomData.users.find((uid: string) => uid !== firebaseUser.uid);
            if (otherUser) {
               setRemoteUserId(otherUser);
               setIsCaller(false); 
               setChatState('connecting');
               await webrtcSetupLocalStream(); // This will then trigger startCall via other useEffect
            } else {
              console.error("Room data found, but other user ID missing.");
              handleStopChat(false); // Invalid state
            }
          } else {
            console.error("Room data not found for incoming call, or users array missing.");
            handleStopChat(false); // Invalid state
          }
        } else if (userStatus && userStatus.status === 'idle' && roomId) {
          // If user status is idle but they are in a room (e.g. partner disconnected and cleaned up)
          if (chatState !== 'idle') { // Only if not already idle
             console.log("User status is idle, but was in a room. Cleaning up client-side.");
             handleStopChat(false);
          }
        }
      });
      return () => unsub();
    }
  }, [firebaseUser, roomId, chatState]); // Added chatState to dependencies


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
                   <Button onClick={() => handleStopChat(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10" disabled={isInteractionDisabled}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChat(false)} variant="destructive" size="sm" disabled={isInteractionDisabled}>
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
                    reportingUserId={firebaseUser.uid} 
                    currentRoomId={roomId}
                    onSubmitReport={handleSubmitReport}
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
    
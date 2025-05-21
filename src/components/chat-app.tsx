
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
import type { ChatMessage, ChatState, ReportData } from '@/types';
import { Send, Loader2, MessageSquare, Search, XCircle, Languages, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { moderateText, type ModerateTextInput } from '@/ai/flows/ai-moderation';
import { translateMessage, type TranslateMessageInput } from '@/ai/flows/real-time-translation';
import * as FirestoreService from '@/lib/firestore-service';
import { useWebRTCSignaling } from '@/hooks/use-webrtc-signaling';
import { db } from '@/lib/firebase'; // Added import for db
import { onSnapshot, doc } from 'firebase/firestore'; // Added imports for onSnapshot and doc

export default function ChatApp() {
  const { user: firebaseUser } = useFirebaseAuth();
  const { toast } = useToast();

  const [keywords, setKeywords] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<ChatState>('idle');
  
  const [roomId, setRoomId] = useState<string | null>(null);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { 
    startCall: webrtcStartCall, 
    cleanup: webrtcCleanup,
    setupLocalStream: webrtcSetupLocalStream, 
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
        toast({ title: "Connection Lost", description: "The connection to your partner was lost.", variant: "destructive" });
        handleStopChat(false); // Don't initiate search
      }
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Message listener
  useEffect(() => {
    if (roomId && chatState === 'chatting') {
      const unsubscribe = FirestoreService.listenForMessages(roomId, (newMessages) => {
        setMessages(prevMessages => {
          const uniqueNewMessages = newMessages.filter(nm => !prevMessages.some(pm => pm.id === nm.id));
          // Simple merge and sort, might need optimization for large history
          return [...prevMessages, ...uniqueNewMessages]
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map(msg => ({...msg, isLocalUser: msg.userId === firebaseUser?.uid }));
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
    setChatState('searching');
    toast({ title: "Searching...", description: "Looking for a chat partner." });

    await FirestoreService.updateUserStatus(firebaseUser.uid, 'searching', keywords.split(',').map(k => k.trim()).filter(Boolean));
    
    // Simplified matching: try to find a match, if not, wait.
    // This part needs robust backend logic or Cloud Functions for production.
    const matchedUser = await FirestoreService.findMatch(firebaseUser.uid, keywords.split(',').map(k => k.trim()));

    if (matchedUser && matchedUser.userId !== firebaseUser.uid) {
      setRemoteUserId(matchedUser.userId);
      const newRoomId = await FirestoreService.createRoom(firebaseUser.uid, matchedUser.userId, keywords.split(',').map(k => k.trim()));
      setRoomId(newRoomId);
      setIsCaller(true); // The one initiating the match becomes the caller
      
      await FirestoreService.updateUserStatus(firebaseUser.uid, 'chatting', undefined, newRoomId);
      await FirestoreService.updateUserStatus(matchedUser.userId, 'chatting', undefined, newRoomId);

      setChatState('connecting');
      await webrtcSetupLocalStream(); // Setup local stream first
      // Then start call, which will trigger negotiation
    } else {
      // No immediate match, user remains 'searching'. Another user might find them.
      // For this MVP, we'll make user wait or manually trigger another search.
      // A listener for incoming connections would be needed here.
      // This part is simplified. We'll assume the user might become a callee if someone finds them.
      // For now, let's simulate the callee side setup if a room appears (e.g. via a listener not implemented here)
      console.log("No immediate match found. User is now discoverable.");
      // To make this demo work somewhat, we can set a timeout and if no room, revert to idle.
      // This is not a good production approach.
      setTimeout(() => {
        if(chatState === 'searching' && !roomId) {
          toast({ title: "No match found", description: "Try broadening your keywords or try again later."});
          setChatState('idle');
        }
      }, 15000); // 15 seconds timeout for search
    }
  };
  
  // Effect to initiate WebRTC call once room and users are set
  useEffect(() => {
    if (chatState === 'connecting' && roomId && firebaseUser?.uid && remoteUserId && localStream) {
      webrtcStartCall(isCaller);
    }
  }, [chatState, roomId, firebaseUser, remoteUserId, localStream, isCaller, webrtcStartCall]);


  const handleSendMessage = async () => {
    if (!currentMessage.trim() || !firebaseUser || !roomId || chatState !== 'chatting') return;

    const moderationInput: ModerateTextInput = { text: currentMessage };
    try {
      const moderationResult = await moderateText(moderationInput);
      if (!moderationResult.isSafe) {
        toast({ title: "Message Moderated", description: `Your message was flagged as inappropriate: ${moderationResult.reason || 'Unknown reason'}. It has not been sent.`, variant: "destructive" });
        setCurrentMessage('');
        return;
      }
    } catch (error) {
      console.error("Moderation error:", error);
      toast({ title: "Moderation Error", description: "Could not moderate message. Sending anyway (in a real app, this might be blocked).", variant: "destructive" });
    }

    const newMessage: Omit<ChatMessage, 'id' | 'timestamp' | 'isLocalUser'> = {
      userId: firebaseUser.uid,
      text: currentMessage,
      originalText: currentMessage, // Store original for potential "show original" after translation
    };
    
    try {
      await FirestoreService.sendMessage(roomId, newMessage);
      setCurrentMessage('');
    } catch (error) {
      console.error("Error sending message:", error);
      toast({ title: "Send Error", description: "Could not send message.", variant: "destructive" });
    }
  };

  const handleTranslateMessage = async (messageId: string, textToTranslate: string, context: string): Promise<{ translatedText: string } | { error: string }> => {
    try {
      const targetLanguage = navigator.language.split('-')[0] || 'en'; // Basic target language detection
      const translationInput: TranslateMessageInput = {
        text: textToTranslate,
        sourceLanguage: "auto", // Or try to detect, or let user specify
        targetLanguage: targetLanguage,
        context: context,
      };
      const result = await translateMessage(translationInput);
      
      // Update message in local state (in real app, might update Firestore or just local display)
      setMessages(prevMessages => prevMessages.map(msg => 
        msg.id === messageId ? { ...msg, translatedText: result.translatedText, text: result.translatedText, isTranslating: false } : msg
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
    if (roomId) {
      await FirestoreService.cleanupRoom(roomId);
    }
    webrtcCleanup();
    setRoomId(null);
    setRemoteUserId(null);
    setMessages([]);
    setLocalStream(null);
    setRemoteStream(null);
    setIsCaller(false);
    if (initiateNewSearch) {
      handleStartSearch();
    } else {
      setChatState('idle');
      if (firebaseUser) {
        await FirestoreService.updateUserStatus(firebaseUser.uid, 'idle');
      }
    }
  };

  const handleSubmitReport = async (reportData: ReportData) => {
    try {
      await FirestoreService.createReport(reportData);
    } catch (error) {
      console.error("Failed to submit report via ChatApp:", error);
      throw error; // Re-throw to be caught by ReportDialog
    }
  };
  
  // This is a simplified callee listener. In a real app, this would be more robust,
  // possibly using Firestore listeners on the user's status document.
  useEffect(() => {
    if (firebaseUser && chatState === 'searching' && !roomId) { // Added !roomId to prevent re-running if already connected
      const userStatusRef = doc(db, "userStatuses", firebaseUser.uid);
      const unsub = onSnapshot(userStatusRef, async (docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data();
          if (userData.status === 'chatting' && userData.roomId && !roomId) { // Check !roomId again before setting
            console.log("Detected incoming call/match. Joining room:", userData.roomId);
            setRoomId(userData.roomId);
            const roomData = await FirestoreService.getRoomData(userData.roomId);
            if (roomData && roomData.users) {
              const otherUser = roomData.users.find((uid: string) => uid !== firebaseUser.uid);
              if (otherUser) {
                 setRemoteUserId(otherUser);
                 setIsCaller(false); 
                 setChatState('connecting');
                 await webrtcSetupLocalStream();
              }
            }
          }
        }
      });
      return () => unsub();
    }
  }, [firebaseUser, chatState, roomId, webrtcSetupLocalStream, toast]);


  if (!firebaseUser) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Authenticating...</p>
      </div>
    );
  }

  const isLoading = chatState === 'searching' || chatState === 'connecting';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="p-4 border-b border-border shadow-sm bg-card">
        <h1 className="text-2xl font-semibold text-primary">Chatter Anon</h1>
      </header>

      <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {chatState !== 'chatting' && chatState !== 'connecting' && (
           <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg">Find a Chat Partner</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="text"
                placeholder="Enter keywords (e.g., travel, gaming), comma-separated"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="mb-4"
                disabled={isLoading}
              />
            </CardContent>
            <CardFooter>
               <Button onClick={handleStartSearch} disabled={isLoading} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
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
                  <MessageSquare className="mr-2 h-5 w-5 text-primary" /> Chatting
                </CardTitle>
                <div className="flex gap-2">
                   <Button onClick={() => handleStopChat(true)} variant="outline" size="sm" className="border-accent text-accent hover:bg-accent/10">
                    <RotateCcw className="mr-2 h-4 w-4" /> Next Chat
                  </Button>
                  <Button onClick={() => handleStopChat(false)} variant="destructive" size="sm">
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
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Connecting to partner...
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
        {chatState === 'idle' && !localStream && !remoteStream && (
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

    
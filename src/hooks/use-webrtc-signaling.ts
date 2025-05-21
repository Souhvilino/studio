"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { sendSignal, listenForSignals, cleanupRoom as firestoreCleanupRoom } from '@/lib/firestore-service';
import { useToast } from '@/hooks/use-toast';

// Placeholder for STUN/TURN server configuration
const RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Add TURN servers here if needed for NAT traversal
  ],
};

interface UseWebRTCSignalingProps {
  roomId: string | null;
  currentUserId: string | null;
  remoteUserId: string | null;
  onRemoteStream: (stream: MediaStream | null) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onConnectionStateChange?: (state: RTCIceConnectionState) => void;
}

export function useWebRTCSignaling({
  roomId,
  currentUserId,
  remoteUserId,
  onRemoteStream,
  onLocalStream,
  onConnectionStateChange,
}: UseWebRTCSignalingProps) {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();
  const [isNegotiating, setIsNegotiating] = useState(false);

  const setupLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      return stream;
    } catch (error) {
      console.error("Error accessing media devices.", error);
      toast({ title: "Media Error", description: "Could not access camera/microphone. Please check permissions.", variant: "destructive" });
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, toast]);

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId) return null;

    const pc = new RTCPeerConnection(RTC_CONFIGURATION);

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId) {
        sendSignal(roomId, currentUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      onRemoteStream(event.streams[0]);
    };

    pc.onnegotiationneeded = async () => {
      if (isNegotiating || pc.signalingState !== 'stable') return;
      setIsNegotiating(true);
      try {
        console.log('Negotiation needed, creating offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (roomId && currentUserId) {
           sendSignal(roomId, currentUserId, { type: 'offer', sdp: pc.localDescription?.sdp });
        }
      } catch (err) {
        console.error('Error during negotiationneeded:', err);
      } finally {
        setIsNegotiating(false);
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      onConnectionStateChange?.(pc.iceConnectionState);
      console.log(`ICE connection state: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
        // Handle connection failure, possibly try to restart ICE or notify user
      }
    };
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [roomId, currentUserId, onRemoteStream, onConnectionStateChange, isNegotiating]);


  const startCall = useCallback(async (isCaller: boolean) => {
    console.log("useWebRTCSignaling: startCall, isCaller:", isCaller);
    const stream = await setupLocalStream();
    if (!stream) return;

    const pc = peerConnectionRef.current || createPeerConnection();
    if (!pc) return;

    if (isCaller) {
      // onnegotiationneeded will handle offer creation
    }
  }, [setupLocalStream, createPeerConnection]);


  useEffect(() => {
    if (!roomId || !remoteUserId) return;

    const pc = peerConnectionRef.current || createPeerConnection();
    if (!pc) return;

    const unsubscribe = listenForSignals(roomId, remoteUserId, async (signal) => {
      console.log("Received signal:", signal);
      if (!peerConnectionRef.current) {
        console.warn("PeerConnection not ready while handling signal");
        return;
      }
      
      try {
        if (signal.type === 'offer') {
          if (peerConnectionRef.current.signalingState !== 'stable' && peerConnectionRef.current.signalingState !== 'have-remote-offer') {
            console.warn(`Cannot set remote offer in state: ${peerConnectionRef.current.signalingState}`);
            // Potentially queue the offer or reset connection
            return;
          }
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          if (roomId && currentUserId) {
            sendSignal(roomId, currentUserId, { type: 'answer', sdp: peerConnectionRef.current.localDescription?.sdp });
          }
        } else if (signal.type === 'answer') {
           if (peerConnectionRef.current.signalingState !== 'have-local-offer') {
            console.warn(`Cannot set remote answer in state: ${peerConnectionRef.current.signalingState}`);
            return;
          }
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
        } else if (signal.type === 'candidate') {
          if (signal.candidate && peerConnectionRef.current.remoteDescription) { // Only add candidate if remote description is set
             await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            console.log("Skipping ICE candidate, remote description not set or candidate empty.");
          }
        }
      } catch (error) {
        console.error("Error handling signal:", error);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection]);


  const cleanup = useCallback(async () => {
    console.log("useWebRTCSignaling: cleanup");
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      onLocalStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    onRemoteStream(null);
    if (roomId) {
      // Optionally, inform Firestore about room cleanup
      // await firestoreCleanupRoom(roomId);
    }
  }, [roomId, onLocalStream, onRemoteStream]);

  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}

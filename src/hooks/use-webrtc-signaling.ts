
"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import * as FirestoreService from '@/lib/firestore-service'; // Use the implemented service
import { useToast } from '@/hooks/use-toast';
import type { SignalPayload } from '@/types';


const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN servers here for production scenarios
  ],
};

interface UseWebRTCSignalingProps {
  roomId: string | null;
  currentUserId: string | null;
  remoteUserId: string | null;
  onRemoteStream: (stream: MediaStream | null) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onConnectionStateChange?: (state: RTCIceConnectionState | string) => void;
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
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);


  const setupLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
        console.log("Local stream already exists.");
        onLocalStream(localStreamRef.current); // Ensure parent knows
        return localStreamRef.current;
    }
    try {
      console.log("Attempting to get user media...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log("Local stream acquired:", stream);
      return stream;
    } catch (error) {
      console.error("Error accessing media devices.", error);
      toast({ title: "Media Error", description: "Could not access camera/microphone. Please check permissions.", variant: "destructive" });
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, toast]);

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn("Cannot create peer connection: missing roomId, currentUserId, or remoteUserId", {roomId, currentUserId, remoteUserId});
      return null;
    }
    
    console.log("Creating new PeerConnection");
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        console.log("Sending ICE candidate:", event.candidate);
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      console.log("Remote track received:", event.streams[0]);
      onRemoteStream(event.streams[0]);
    };
    
    pc.onnegotiationneeded = async () => {
      if (makingOffer.current || pc.signalingState !== 'stable') {
        console.log('onnegotiationneeded triggered, but already making offer or not stable. State:', pc.signalingState);
        return;
      }
      try {
        makingOffer.current = true;
        console.log('Negotiation needed, creating offer...');
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') { // Re-check state after await
             console.warn("Signaling state changed before setting local description for offer. Aborting negotiationneeded.");
             makingOffer.current = false;
             return;
        }
        await pc.setLocalDescription(offer);
        console.log('Local description (offer) set:', pc.localDescription);
        if (roomId && currentUserId && remoteUserId && pc.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
           console.log("Offer sent to remote user.");
        }
      } catch (err) {
        console.error('Error during onnegotiationneeded:', err);
      } finally {
        makingOffer.current = false;
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      onConnectionStateChange?.(pc.iceConnectionState);
      console.log(`ICE connection state: ${pc.iceConnectionState}`);
    };

    pc.onsignalingstatechange = () => {
        console.log(`Signaling state changed to: ${pc.signalingState}`);
        // If we become stable and were ignoring offers, reset ignoreOffer
        if (pc.signalingState === 'stable') {
            ignoreOffer.current = false;
            makingOffer.current = false; // Also reset makingOffer if stable
        }
    };
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        console.log("Adding local track to PeerConnection:", track);
        pc.addTrack(track, localStreamRef.current!);
      });
    } else {
        console.warn("Local stream not available when creating peer connection. Tracks won't be added yet.");
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, toast]);


  const startCall = useCallback(async (isCaller: boolean) => {
    console.log("useWebRTCSignaling: startCall invoked. Is Caller:", isCaller);
    const stream = await setupLocalStream(); // Ensure local stream is ready
    if (!stream) {
      console.error("Failed to setup local stream for startCall.");
      onConnectionStateChange?.('failed_local_media');
      return;
    }

    if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === "closed") {
        console.log("No existing PC or PC is closed, creating a new one for startCall.");
        createPeerConnection();
    } else {
        console.log("Existing PC found for startCall. Current signaling state:", peerConnectionRef.current.signalingState);
        // If PC exists but tracks not added, add them now
        if (localStreamRef.current && peerConnectionRef.current.getSenders().length === 0) {
            localStreamRef.current.getTracks().forEach(track => {
              if (peerConnectionRef.current && !peerConnectionRef.current.getSenders().find(s => s.track === track)) {
                console.log("Adding missing local track to existing PeerConnection:", track);
                peerConnectionRef.current.addTrack(track, localStreamRef.current!);
              }
            });
        }
    }
    // For caller, onnegotiationneeded should be triggered if tracks were just added or by createOffer if needed.
    // For callee, they wait for an offer.
    // The onnegotiationneeded event on the PC instance should handle offer creation for the caller.
    // If `isCaller` is true and `onnegotiationneeded` doesn't fire (e.g., already negotiated but new call attempt),
    // we might need to manually trigger it, but usually adding tracks to a stable connection will trigger it.
    if (isCaller && peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
        console.log("Caller is stable, ensuring negotiationneeded fires if tracks were just added or re-triggering offer.");
        // Await onnegotiationneeded or manually create offer
        // This can be tricky; often just adding tracks is enough.
        // If negotiation is stuck, this is a place to add a manual offer creation.
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
        console.log("Signaling listener useEffect: Not all IDs present, skipping.", {roomId, remoteUserId, currentUserId});
        return;
    }

    // Ensure PC is created if it doesn't exist.
    // This is important if this effect runs before startCall has a chance to create it.
    if (!peerConnectionRef.current) {
        console.log("Signaling listener useEffect: PC does not exist, creating one.");
        createPeerConnection(); 
    }
    const pc = peerConnectionRef.current;
    if (!pc) {
        console.error("Signaling listener useEffect: PeerConnection still null after attempt to create.");
        return;
    }

    console.log(`Setting up signal listener for room ${roomId}, current user ${currentUserId}, listening for signals from ${remoteUserId}`);
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      console.log("Received signal:", signal, "Current PC signaling state:", pc.signalingState);
      
      try {
        if (signal.type === 'offer') {
          if (makingOffer.current) {
            // Polite peer collision handling: higher UID drops their offer if both make one.
            // For simplicity here, just log. A more robust solution is needed for perfect collision handling.
            console.warn('Glare condition: both peers made an offer. Current logic might lead to issues.');
            // Basic glare handling: if current user's ID is "larger", they might ignore the incoming offer.
            // This is a very simplified approach. True glare handling is complex.
            if (currentUserId > remoteUserId) {
                console.log("Ignoring offer due to glare handling (my ID is larger).");
                ignoreOffer.current = true;
                return;
            }
          }
          if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
             console.warn(`Offer received in invalid state: ${pc.signalingState}. Potentially a glare issue or race condition.`);
             // If we are not stable, and an offer comes, it might be a glare.
             // Or if we are have-local-offer, an offer means glare.
             // If have-remote-offer, another offer is an error or misordered signal.
             if (pc.signalingState === 'have-local-offer') { // Glare: we sent an offer, they sent an offer
                // One side needs to roll back. For now, let's proceed cautiously.
             }
            //  return; // Or attempt rollback / re-negotiation
          }

          console.log("Setting remote description (offer):", signal.sdp);
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          
          console.log("Creating answer...");
          const answer = await pc.createAnswer();
          console.log("Setting local description (answer):", answer.sdp);
          await pc.setLocalDescription(answer);

          if (roomId && currentUserId && remoteUserId && pc.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: pc.localDescription.sdp });
            console.log("Answer sent.");
          }
        } else if (signal.type === 'answer') {
           if (pc.signalingState !== 'have-local-offer') {
            console.warn(`Answer received in invalid state: ${pc.signalingState}.`);
            return; // Only apply answer if we have a local offer
          }
          console.log("Setting remote description (answer):", signal.sdp);
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          console.log("Remote description (answer) set.");
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (pc.remoteDescription) { 
             console.log("Adding ICE candidate:", signal.candidate);
             await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
             console.log("ICE candidate added.");
          } else {
            console.warn("Skipping ICE candidate, remote description not set yet. Candidate will be queued by the browser.");
            // Browsers usually queue candidates received before remote description is set.
          }
        }
      } catch (error) {
        console.error("Error handling signal:", signal.type, error);
      }
    });

    return () => {
      console.log("Cleaning up signal listener for room:", roomId);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection]);


  const cleanup = useCallback(async () => {
    console.log("useWebRTCSignaling: cleanup called for room", roomId);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null; // Clear the ref
      onLocalStream(null); // Notify parent
      console.log("Local stream stopped and cleared.");
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null; // Clear the ref
      console.log("PeerConnection closed and cleared.");
    }
    onRemoteStream(null); // Notify parent
    setIsNegotiating(false);
    makingOffer.current = false;
    ignoreOffer.current = false;
    onConnectionStateChange?.('closed');
    // Note: Firestore room cleanup (updating status, etc.) is handled by ChatApp component
  }, [roomId, onLocalStream, onRemoteStream, onConnectionStateChange]);

  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}

    

"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import * as FirestoreService from '@/lib/firestore-service'; 
import { useToast } from '@/hooks/use-toast';
import type { SignalPayload } from '@/types';


const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
  const [isNegotiating, setIsNegotiating] = useState(false); // To prevent offer/answer cycles
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const CUID_SHORT = currentUserId?.substring(0,5) || 'unknown';


  const setupLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] Local stream already exists.`);
        onLocalStream(localStreamRef.current); 
        return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] Local stream acquired:`, stream.id, stream.getTracks());
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] Error accessing media devices.`, error);
      toast({ title: "Media Error", description: "Could not access camera/microphone. Please check permissions.", variant: "destructive" });
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, toast, CUID_SHORT]);

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn(`[WebRTC ${CUID_SHORT}] Cannot create peer connection: missing IDs`, {roomId, currentUserId, remoteUserId});
      return null;
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] Creating new PeerConnection`);
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnectionRef.current = pc; // Set ref immediately

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] Sending ICE candidate:`, event.candidate.candidate.substring(0, 30) + "...");
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Number of streams: ${event.streams.length}`);
      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        console.log(`[WebRTC ${CUID_SHORT}] Remote stream from ontrack: ID=${remoteStream.id}, Active=${remoteStream.active}`);
        remoteStream.getTracks().forEach(track => {
          console.log(`[WebRTC ${CUID_SHORT}] Remote track: Kind=${track.kind}, ID=${track.id}, Label=${track.label}, Enabled=${track.enabled}, ReadyState=${track.readyState}`);
          track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote track ID ${track.id} (${track.kind}) unmuted.`);
          track.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote track ID ${track.id} (${track.kind}) muted.`);
          track.onended = () => console.log(`[WebRTC ${CUID_SHORT}] Remote track ID ${track.id} (${track.kind}) ended.`);
        });
        onRemoteStream(remoteStream);
      } else if (event.track) {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK event.streams[0] is undefined, but event.track exists. Track kind: ${event.track.kind}. This scenario might need more handling.`);
        onRemoteStream(null); 
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK event received, but no streams[0] and no event.track. Event:`, event);
        onRemoteStream(null);
      }
    };
    
    pc.onnegotiationneeded = async () => {
      if (makingOffer.current || pc.signalingState !== 'stable' || isNegotiating) {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded triggered, but already making offer, not stable, or isNegotiating. State: ${pc.signalingState}, makingOffer: ${makingOffer.current}, isNegotiating: ${isNegotiating}`);
        return;
      }
      try {
        makingOffer.current = true;
        setIsNegotiating(true);
        console.log(`[WebRTC ${CUID_SHORT}] Negotiation needed, creating offer...`);
        
        if (localStreamRef.current) {
          console.log(`[WebRTC ${CUID_SHORT}] Caller: Local tracks on PC before creating offer:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
        }

        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') { 
             console.warn(`[WebRTC ${CUID_SHORT}] Signaling state changed to ${pc.signalingState} before setting local description for offer. Aborting negotiationneeded.`);
             makingOffer.current = false;
             setIsNegotiating(false);
             return;
        }
        await pc.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT}] Local description (offer) set. SDP:`, pc.localDescription?.sdp.substring(0,50) + "...");
        if (roomId && currentUserId && remoteUserId && pc.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
           console.log(`[WebRTC ${CUID_SHORT}] Offer sent to remote user.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] Error during onnegotiationneeded:`, err);
      } finally {
        makingOffer.current = false;
        setIsNegotiating(false);
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC ${CUID_SHORT}] ICE connection state: ${pc.iceConnectionState}`);
      onConnectionStateChange?.(pc.iceConnectionState);
    };

    pc.onsignalingstatechange = () => {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${pc.signalingState}`);
        if (pc.signalingState === 'stable') {
            ignoreOffer.current = false;
            makingOffer.current = false; 
            setIsNegotiating(false);
        }
    };
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        if (!pc.getSenders().find(s => s.track === track)) {
          console.log(`[WebRTC ${CUID_SHORT}] Adding local track to PeerConnection during creation: ${track.kind} (${track.id.substring(0,5)})`);
          pc.addTrack(track, localStreamRef.current!);
        }
      });
    } else {
        console.warn(`[WebRTC ${CUID_SHORT}] Local stream not available when creating peer connection. Tracks won't be added yet.`);
    }
    return pc;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, toast, CUID_SHORT, isNegotiating /* Added isNegotiating */ ]);


  const startCall = useCallback(async (isCaller: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCaller}`);
    const stream = await setupLocalStream(); 
    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] Failed to setup local stream for startCall.`);
      onConnectionStateChange?.('failed_local_media');
      return;
    }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
        console.log(`[WebRTC ${CUID_SHORT}] No existing PC or PC is closed, creating a new one for startCall.`);
        pc = createPeerConnection(); 
        if (!pc) {
            console.error(`[WebRTC ${CUID_SHORT}] Failed to create peer connection in startCall.`);
            return;
        }
    } else {
        console.log(`[WebRTC ${CUID_SHORT}] Existing PC found. State: ${pc.signalingState}`);
    }

    if (localStreamRef.current && pc && pc.signalingState !== 'closed') {
        const existingTrackIds = new Set(pc.getSenders().map(sender => sender.track?.id).filter(Boolean));
        localStreamRef.current.getTracks().forEach(track => {
            if (!existingTrackIds.has(track.id)) {
                try {
                    console.log(`[WebRTC ${CUID_SHORT}] Adding local track to PC in startCall: ${track.kind} (${track.id.substring(0,5)})`);
                    pc.addTrack(track, localStreamRef.current!);
                } catch (e) {
                    console.error(`[WebRTC ${CUID_SHORT}] Error adding track in startCall: ${track.kind}`, e);
                }
            }
        });
        console.log(`[WebRTC ${CUID_SHORT}] Senders after ensuring tracks in startCall:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
    } else {
      console.warn(`[WebRTC ${CUID_SHORT}] Cannot add tracks in startCall: localStreamRef.current is ${localStreamRef.current ? 'valid' : 'null'}, pc is ${pc ? pc.signalingState : 'null'}`);
    }
    
    if (isCaller && pc && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiating) {
        console.log(`[WebRTC ${CUID_SHORT}] Caller is stable, explicitly triggering negotiation for offer.`);
        // Manually trigger onnegotiationneeded logic if it doesn't fire automatically
        // This can happen if tracks are added but the browser doesn't trigger it.
        // Forcing an offer creation.
        setIsNegotiating(true);
        makingOffer.current = true;
        pc.createOffer()
          .then(offer => {
            if (pc.signalingState !== 'stable') {
                console.warn(`[WebRTC ${CUID_SHORT}] Signaling state changed to ${pc.signalingState} before manual offer's setLocalDescription. Aborting.`);
                makingOffer.current = false;
                setIsNegotiating(false);
                return;
            }
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            console.log(`[WebRTC ${CUID_SHORT}] Manual offer's Local description set. SDP:`, pc.localDescription?.sdp.substring(0,50) + "...");
            if (roomId && currentUserId && remoteUserId && pc.localDescription) {
               FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
               console.log(`[WebRTC ${CUID_SHORT}] Manual Offer sent to remote user.`);
            }
          })
          .catch(err => console.error(`[WebRTC ${CUID_SHORT}] Error creating/sending manual offer:`, err))
          .finally(() => {
            makingOffer.current = false;
            setIsNegotiating(false);
          });
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange, CUID_SHORT, roomId, currentUserId, remoteUserId, isNegotiating]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping.`, {roomId, remoteUserId, currentUserId});
        return;
    }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === 'closed') { // Ensure PC is valid or create
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: PC is null or closed, creating one.`);
        pc = createPeerConnection();
        if (!pc) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Failed to create PeerConnection.`);
          return;
        }
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, listening for signals from ${remoteUserId}. PC State: ${pc.signalingState}`);
    
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const pcInstance = peerConnectionRef.current; // Use current ref inside async callback
      if (!pcInstance || pcInstance.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal but PC is null or closed. Ignoring signal type: ${signal.type}`);
          return;
      }
      console.log(`[WebRTC ${CUID_SHORT}] Received signal:`, signal.type, `PC signaling state: ${pcInstance.signalingState}`);
      
      try {
        if (signal.type === 'offer') {
          if (makingOffer.current || pcInstance.signalingState === 'have-local-offer' || ignoreOffer.current || isNegotiating) {
            console.warn(`[WebRTC ${CUID_SHORT}] Glare or conflict: received offer while making offer, having local offer, ignoring, or negotiating. My ID: ${currentUserId}, Remote: ${remoteUserId}. makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}, isNegotiating: ${isNegotiating}, state: ${pcInstance.signalingState}`);
            // Basic glare: if my ID is "larger", I might ignore their offer if I'm also making one.
            // A more robust glare handling might involve comparing who initiated first or a random rollback.
            if (currentUserId > remoteUserId && (makingOffer.current || pcInstance.signalingState === 'have-local-offer')) {
                console.log(`[WebRTC ${CUID_SHORT}] Glare: Ignoring incoming offer as my ID is larger and I'm also offering.`);
                return; // Simple glare handling: higher ID wins if both offer concurrently
            }
            ignoreOffer.current = true; // Mark to ignore subsequent offers if we proceed with this one
          }
          
          setIsNegotiating(true);
          console.log(`[WebRTC ${CUID_SHORT}] Setting remote description (offer): SDP=${signal.sdp?.substring(0,50)}...`);
          await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          
          if (localStreamRef.current && pcInstance.getSenders().length === 0) {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] Offer received, local tracks not yet added to PC. Adding them now.`);
             localStreamRef.current.getTracks().forEach(track => {
                if (!pcInstance.getSenders().find(s => s.track === track)) {
                    pcInstance.addTrack(track, localStreamRef.current!);
                }
             });
          } else if (!localStreamRef.current) {
             console.error(`[WebRTC ${CUID_SHORT} Callee] Offer received, but local stream is null. Cannot create answer with media.`);
          }
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before creating answer:`, pcInstance.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));


          console.log(`[WebRTC ${CUID_SHORT}] Creating answer...`);
          const answer = await pcInstance.createAnswer();
          console.log(`[WebRTC ${CUID_SHORT}] Setting local description (answer): SDP=${answer.sdp?.substring(0,50)}...`);
          await pcInstance.setLocalDescription(answer);

          if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: pcInstance.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT}] Answer sent.`);
          }
          setIsNegotiating(false);
          ignoreOffer.current = false; // Reset after successfully handling offer

        } else if (signal.type === 'answer') {
           if (pcInstance.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT}] Answer received but PC not in 'have-local-offer' state. Current state: ${pcInstance.signalingState}. Ignoring.`);
            return; 
          }
          console.log(`[WebRTC ${CUID_SHORT}] Setting remote description (answer): SDP=${signal.sdp?.substring(0,50)}...`);
          await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT}] Remote description (answer) set.`);
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (pcInstance.remoteDescription) { 
             console.log(`[WebRTC ${CUID_SHORT}] Adding ICE candidate:`, (signal.candidate as RTCIceCandidate).candidate?.substring(0,30) + "...");
             await pcInstance.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
             console.log(`[WebRTC ${CUID_SHORT}] ICE candidate added.`);
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description not set yet. Candidate will be queued by browser.`);
            // Queue candidate if necessary, though modern browsers often handle this automatically.
            // For robustness, you might implement an explicit queue here.
             await pcInstance.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal type ${signal.type}:`, error);
        setIsNegotiating(false); // Reset on error
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room:`, roomId);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, isNegotiating /* Added isNegotiating */]);


  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room`, roomId);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null; 
      onLocalStream(null); 
      console.log(`[WebRTC ${CUID_SHORT}] Local stream stopped and cleared.`);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.oniceconnectionstatechange = null;
      peerConnectionRef.current.onsignalingstatechange = null;
      peerConnectionRef.current.onnegotiationneeded = null;
      
      if (peerConnectionRef.current.signalingState !== 'closed') {
        peerConnectionRef.current.close();
      }
      peerConnectionRef.current = null; 
      console.log(`[WebRTC ${CUID_SHORT}] PeerConnection closed and cleared.`);
    }
    onRemoteStream(null); 
    setIsNegotiating(false);
    makingOffer.current = false;
    ignoreOffer.current = false;
    onConnectionStateChange?.('closed'); // This should be the last thing
  }, [roomId, onLocalStream, onRemoteStream, onConnectionStateChange, CUID_SHORT]);

  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}

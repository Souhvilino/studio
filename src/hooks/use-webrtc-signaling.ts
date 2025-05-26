"use client";

import { useEffect, useCallback, useRef } from 'react';
import * as FirestoreService from '@/lib/firestore-service';
import { useToast } from '@/hooks/use-toast';
import type { SignalPayload } from '@/types';

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:relay1.expressturn.com:3480',
      username: '174822759307587793',
      credential: 'gFk3ZR4TR5WvtAd8hSq2FWrzJ90=',
    },
    {
      urls: 'turn:relay1.expressturn.com:3480?transport=tcp',
      username: '174822759307587793',
      credential: 'gFk3ZR4TR5WvtAd8hSq2FWrzJ90=',
    },
  ],
  // iceTransportPolicy: 'relay', // Forcing TURN can help debug if STUN is failing
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

  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const isNegotiatingRef = useRef(false);
  const politePeer = useRef(false); // True if this client is the callee or has yielded in a glare situation

  const CUID_SHORT = currentUserId?.substring(0, 5) || 'anon';

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs.`);
      return null;
    }

    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}.`);
    const pcInstance = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnectionRef.current = pcInstance;
    // transceiversAddedRef.current = false; // Reset for the new PC instance - Not needed, transceivers are part of PC instance

    // Add initial transceivers. These establish the m-line "slots".
    // Tracks will be added to these senders later via replaceTrack.
    // This ensures the m-line order is established early and consistently.
    if (pcInstance.getSenders().filter(s => s.track || s.receiver).length < 2) { // Ensure we don't re-add if PC is somehow reused
        pcInstance.addTransceiver('audio', { direction: 'sendrecv' });
        pcInstance.addTransceiver('video', { direction: 'sendrecv' });
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Initial audio/video transceivers added.`);
    }


    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] ICE candidate gathered: type=${event.candidate.type}, address=${event.candidate.address}, protocol=${event.candidate.protocol}`);
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      } else if (!event.candidate) {
        console.log(`[WebRTC ${CUID_SHORT}] All ICE candidates gathered.`);
      }
    };
    
    pcInstance.onicecandidateerror = (event) => {
      console.error(`[WebRTC ${CUID_SHORT}] ICE candidate error: Code=${event.errorCode}, Text=${event.errorText}, URL=${event.url}`);
    };

    pcInstance.onicegatheringstatechange = () => {
      if(peerConnectionRef.current) { // Check ref directly
        console.log(`[WebRTC ${CUID_SHORT}] ICE gathering state changed: ${peerConnectionRef.current.iceGatheringState}`);
      }
    };

    pcInstance.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Track details: kind=${event.track.kind}, id=${event.track.id.substring(0,5)}, enabled=${event.track.enabled}, muted=${event.track.muted}, readyState=${event.track.readyState}`);
      event.track.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track MUTED: ${event.track.id.substring(0,5)}`);
      event.track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track UNMUTED: ${event.track.id.substring(0,5)}`);
      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    pcInstance.onnegotiationneeded = async () => {
      const currentPC = peerConnectionRef.current;
      if (!currentPC || isNegotiatingRef.current || makingOffer.current || currentPC.signalingState !== 'stable') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING. Conditions: isNegotiatingRef=${isNegotiatingRef.current}, makingOffer=${makingOffer.current}, signalingState=${currentPC?.signalingState}`);
        return;
      }
      if (politePeer.current && currentPC.remoteDescription && currentPC.remoteDescription.type === 'offer') {
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Polite peer has remote offer. Should be answering, not offering. SKIPPING.`);
          return;
      }

      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite: ${politePeer.current}. Senders:`, currentPC.getSenders().map(s => s.track?.kind));
        
        const offer = await currentPC.createOffer();
        
        if (currentPC.signalingState !== 'stable') { // Re-check after await
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state changed to ${currentPC.signalingState} before setLocalDescription(offer). Aborting.`);
          makingOffer.current = false; isNegotiatingRef.current = false; return;
        }
        await currentPC.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) by onnegotiationneeded]:`, currentPC.localDescription?.sdp?.substring(0, 100) + "...");
        
        if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
          FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: currentPC.localDescription.sdp });
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error:`, err);
        isNegotiatingRef.current = false;
      } finally {
        makingOffer.current = false;
      }
    };

    pcInstance.oniceconnectionstatechange = () => {
      if (peerConnectionRef.current) { 
        console.log(`[WebRTC ${CUID_SHORT}] ICE connection state: ${peerConnectionRef.current.iceConnectionState}`);
        onConnectionStateChange?.(peerConnectionRef.current.iceConnectionState);
      }
    };
    
    pcInstance.onsignalingstatechange = () => {
      if (peerConnectionRef.current) { 
        console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${peerConnectionRef.current.signalingState}`);
        if (peerConnectionRef.current.signalingState === 'stable') {
          isNegotiatingRef.current = false;
          ignoreOffer.current = false;
          makingOffer.current = false;
        }
      }
    };
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT]);

  const associateTracksWithSenders = useCallback(async (pc: RTCPeerConnection, stream: MediaStream) => {
    console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Associating tracks from stream ${stream.id.substring(0,5)}`);
    const tracks = stream.getTracks();
    for (const track of tracks) {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind || (s.kind === track.kind && !s.track));
        if (sender) {
            if (sender.track !== track) { // Only replace if different track or sender has no track
                console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing ${track.kind} track on sender.`);
                await sender.replaceTrack(track).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing ${track.kind} track:`, e));
            } else {
                console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: ${track.kind} track already on sender.`);
            }
        } else {
            console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No sender found for ${track.kind} track. This is unexpected if transceivers were added by createPeerConnection.`);
            // Optionally, add track if truly no sender for this kind was ever created by addTransceiver
            // pc.addTrack(track, stream); 
        }
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after associateTracksWithSenders:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
  }, [CUID_SHORT]);

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream already exists. Ensuring tracks are on senders.`);
      onLocalStream(localStreamRef.current);
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        await associateTracksWithSenders(pc, localStreamRef.current);
      }
      return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      stream.getTracks().forEach(track => {
        console.log(`[WebRTC ${CUID_SHORT}] Local Track Details: kind=${track.kind}, id=${track.id.substring(0,5)}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });

      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        await associateTracksWithSenders(pc, stream);
      } else if (!pc) {
        console.warn(`[WebRTC ${CUID_SHORT}] setupLocalStream (new stream): PC does not exist yet. Tracks will be associated when PC is created and call starts.`);
      }
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] setupLocalStream: Error accessing media devices.`, error);
      toast({ title: "Media Error", description: "Could not access camera/microphone.", variant: "destructive" });
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, toast, CUID_SHORT, associateTracksWithSenders]);

  const startCall = useCallback(async (isCallerFlag: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}.`);
    politePeer.current = !isCallerFlag;

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: No/Closed PC, creating new one.`);
      pc = createPeerConnection();
      if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    }
    
    const stream = await setupLocalStream(); 
    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting.`);
      return;
    }
    
    if (isCallerFlag) {
      if (pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC state is stable. Triggering onnegotiationneeded.`);
        pc.dispatchEvent(new Event('negotiationneeded'));
      }
    }
  }, [setupLocalStream, createPeerConnection, CUID_SHORT]);

  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) return;
    console.log(`[WebRTC ${CUID_SHORT}] Setting up Firestore signal listener for room ${roomId}, signals from ${remoteUserId}.`);

    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      let currentPC = peerConnectionRef.current; 
      if (!currentPC && signal.type === 'offer') { 
        console.log(`[WebRTC ${CUID_SHORT}] Received offer but PC is null. Creating PC (Callee path).`);
        currentPC = createPeerConnection(); 
        if (!currentPC) { console.error(`[WebRTC ${CUID_SHORT}] Failed to create PC for offer.`); return; }
        politePeer.current = true; 
      } else if (!currentPC || currentPC.signalingState === 'closed') {
        console.warn(`[WebRTC ${CUID_SHORT}] Received signal type ${signal.type} but PC is null/closed. Ignoring.`);
        return;
      }

      console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC state: ${currentPC.signalingState}, isNegotiating: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}`);

      try {
        if (signal.type === 'offer') {
          const offerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, offerSdp.substring(0, 100) + "...");
          
          const offerCollision = makingOffer.current || currentPC.signalingState !== "stable";
          if (offerCollision) {
            ignoreOffer.current = politePeer.current; 
            if (ignoreOffer.current) {
              console.warn(`[WebRTC ${CUID_SHORT} Polite Peer] Glare: Ignoring incoming offer.`); return; 
            }
          }
          
          isNegotiatingRef.current = true;
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Callee] Remote offer set. State: ${currentPC.signalingState}`);
          
          const streamForAnswer = await setupLocalStream(); 
          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Local stream setup failed. Cannot create answer.`);
            isNegotiatingRef.current = false; return;
          }
          
          const answer = await currentPC.createAnswer();
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local) by Callee]:`, answer.sdp?.substring(0,100)+"...");
          
          if (currentPC.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] State is ${currentPC.signalingState} before setLocalDescription(answer). Aborting.`);
             isNegotiatingRef.current = false; return;
          }
          await currentPC.setLocalDescription(answer);
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local answer set. State: ${currentPC.signalingState}`);

          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
          }

        } else if (signal.type === 'answer') {
          const answerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, answerSdp.substring(0,100)+"...");
          if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but state is ${currentPC.signalingState}. Ignoring.`); return;
          }
          isNegotiatingRef.current = true; 
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Caller] Remote answer set. State: ${currentPC.signalingState}`);

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) { 
            try {
              console.log(`[WebRTC ${CUID_SHORT}] Adding received ICE candidate: type=${(signal.candidate as RTCIceCandidateInit).type}`);
              await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
            } catch (e) {
               console.warn(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e);
            }
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but no remote description. Queueing might happen.`);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
        isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false;
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}.`);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream, associateTracksWithSenders]); 

  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room: ${roomIdRef.current}`); 
    const currentPC = peerConnectionRef.current;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      onLocalStream(null); 
      console.log(`[WebRTC ${CUID_SHORT}] Local stream stopped.`);
    }
    if (currentPC) {
      currentPC.ontrack = null;
      currentPC.onicecandidate = null;
      currentPC.oniceconnectionstatechange = null;
      currentPC.onsignalingstatechange = null;
      currentPC.onnegotiationneeded = null;
      currentPC.onicecandidateerror = null;
      currentPC.onicegatheringstatechange = null;

      if (currentPC.signalingState !== 'closed') {
        currentPC.close();
        console.log(`[WebRTC ${CUID_SHORT}] PeerConnection closed.`);
      }
      peerConnectionRef.current = null;
    }
    onRemoteStream(null); 
    isNegotiatingRef.current = false; 
    makingOffer.current = false;
    ignoreOffer.current = false;
    politePeer.current = false;
    // transceiversAddedRef.current = false; // Removed as transceivers are tied to PC instance
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  const roomIdRef = useRef(roomId);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  return { startCall, cleanup, setupLocalStream };
}
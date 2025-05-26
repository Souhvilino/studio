
      
"use client";

import { useEffect, useCallback, useRef, useState } from 'react';
import * as FirestoreService from '@/lib/firestore-service';
import { useToast } from '@/hooks/use-toast';
import type { SignalPayload } from '@/types';

// Confirmed TURN server credentials
const TURN_USERNAME = '174822759307587793';
const TURN_PASSWORD = 'gFk3ZR4TR5WvtAd8hSq2FWrzJ90=';

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:relay1.expressturn.com:3480?transport=udp',
      username: TURN_USERNAME,
      credential: TURN_PASSWORD,
    },
    {
      urls: 'turn:relay1.expressturn.com:3480?transport=tcp',
      username: TURN_USERNAME,
      credential: TURN_PASSWORD,
    },
    // It's common for TURN servers to also offer services over TLS on port 443
    // ExpressTurn might also offer this, or even UDP on 443.
    // Example, you might need to verify if these are supported by ExpressTurn:
    // {
    //   urls: 'turns:relay1.expressturn.com:443?transport=tcp',
    //   username: TURN_USERNAME,
    //   credential: TURN_PASSWORD,
    // },
  ],
  // iceTransportPolicy: 'relay', // Uncomment to force TURN for testing, can help diagnose if STUN is failing
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
  const isNegotiatingRef = useRef(false); // Tracks if an offer/answer exchange is ongoing
  const politePeer = useRef(false); // True if this client should yield in case of offer collision

  const CUID_SHORT = currentUserId?.substring(0, 5) || 'anon';

  const associateTracksWithSenders = useCallback(async (pc: RTCPeerConnection, stream: MediaStream) => {
    console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Associating tracks from stream ${stream.id.substring(0,5)} to PC ${pc.signalingState}`);
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    const senders = pc.getSenders();

    if (audioTrack) {
      const audioSender = senders.find(s => s.track?.kind === 'audio' || s.kind === 'audio');
      if (audioSender) {
        if (audioSender.track !== audioTrack) {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing audio track on sender.`);
          await audioSender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing audio track:`, e));
        }
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No audio sender found. This is unexpected if transceivers were added.`);
      }
    }

    if (videoTrack) {
      const videoSender = senders.find(s => s.track?.kind === 'video' || s.kind === 'video');
      if (videoSender) {
        if (videoSender.track !== videoTrack) {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing video track on sender.`);
          await videoSender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing video track:`, e));
        }
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No video sender found. This is unexpected if transceivers were added.`);
      }
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after associateTracksWithSenders:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
  }, [CUID_SHORT]);

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs. Room: ${roomId}, CurrentUser: ${currentUserId}, RemoteUser: ${remoteUserId}`);
      return null;
    }
    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}. Polite: ${politePeer.current}`);
    const pcInstance = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnectionRef.current = pcInstance;
    
    // Add transceivers for audio and video upfront. This establishes m-line order.
    // These will be populated with tracks later using sender.replaceTrack().
    if (pcInstance.getTransceivers().filter(t => t.mid !== null).length < 2) { // Check if transceivers are already set up
      pcInstance.addTransceiver('audio', { direction: 'sendrecv' });
      pcInstance.addTransceiver('video', { direction: 'sendrecv' });
      console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Initial audio/video transceivers added.`);
    }

    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] ICE candidate gathered: type=${event.candidate.type}, address=${event.candidate.address}, protocol=${event.candidate.protocol}, relatedAddress=${event.candidate.relatedAddress}, relatedPort=${event.candidate.relatedPort}`);
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      } else if (!event.candidate) {
        console.log(`[WebRTC ${CUID_SHORT}] All ICE candidates gathered for this cycle.`);
      }
    };
    
    pcInstance.onicecandidateerror = (event) => {
      console.error(`[WebRTC ${CUID_SHORT}] ICE candidate error: Code=${event.errorCode}, Text=${event.errorText}, URL=${event.url}`);
    };

    pcInstance.onicegatheringstatechange = () => {
      if(peerConnectionRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] ICE gathering state changed: ${peerConnectionRef.current.iceGatheringState}`);
      }
    };

    pcInstance.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Number of streams: ${event.streams.length}. Track kind: ${event.track.kind}, ID: ${event.track.id.substring(0,5)}, muted: ${event.track.muted}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`);
      event.track.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track MUTED: ${event.track.id.substring(0,5)}`);
      event.track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track UNMUTED: ${event.track.id.substring(0,5)}`);

      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      } else {
        // If track is not part of a stream, create one
        console.log(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] undefined. Creating new stream with track: Kind=${event.track.kind}, ID=${event.track.id.substring(0,5)}`);
        const newStream = new MediaStream();
        newStream.addTrack(event.track);
        onRemoteStream(newStream);
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
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite: ${politePeer.current}. PC Senders:`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
        
        const offer = await currentPC.createOffer();
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) by onnegotiationneeded]:`, offer.sdp?.substring(0, 100) + "...");
        
        // Re-check state *after* await, as it might have changed (e.g., due to incoming offer)
        if (currentPC.signalingState !== 'stable') {
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state changed to ${currentPC.signalingState} before setLocalDescription(offer). Aborting offer creation from onnegotiationneeded.`);
          makingOffer.current = false; 
          // isNegotiatingRef will be reset by the other process that changed the state
          return;
        }
        await currentPC.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: pc.setLocalDescription(offer) SUCCEEDED. New state: ${currentPC.signalingState}`);
        
        if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
          FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: currentPC.localDescription.sdp });
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error:`, err);
      } finally {
        makingOffer.current = false;
        // Do not set isNegotiatingRef to false here, let the offer/answer resolution do it
        // when signalingState becomes 'stable' again.
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
          // Glare-related flags are reset here
          makingOffer.current = false; 
          ignoreOffer.current = false;
        }
      }
    };
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT]);

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Re-using active local stream. ID: ${localStreamRef.current.id.substring(0,5)}`);
      onLocalStream(localStreamRef.current);
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are updated/added.`);
        await associateTracksWithSenders(pc, localStreamRef.current);
      }
      return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id.substring(0,5)}, Tracks:`, stream.getTracks().map(t => ({kind: t.kind, id: t.id.substring(0,5), label: t.label.substring(0,10), enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are updated/added.`);
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
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}. RoomID: ${roomId}, RemoteUID: ${remoteUserId}`);
    politePeer.current = !isCallerFlag; // Caller is impolite, callee is polite

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: No/Closed PC, creating new one.`);
      pc = createPeerConnection();
      if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    } else {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Existing PC found. State: ${pc.signalingState}`);
    }
    
    // Ensure local stream is ready and its tracks are associated with senders
    // This will call getUserMedia if needed, or use existing stream
    const stream = await setupLocalStream(); 
    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting.`);
      return;
    }
    console.log(`[WebRTC ${CUID_SHORT}] startCall: Senders after ensuring tracks:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
    
    if (isCallerFlag) { // Only the caller should initiate by creating an offer
      if (pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC state is stable. Triggering negotiation for initial offer.`);
        // onnegotiationneeded should fire due to track association if not already in progress
        // Or, we can be more direct if needed, but usually not required if tracks are set on transceivers.
        // Forcing it if onnegotiationneeded is unreliable:
        makingOffer.current = true;
        isNegotiatingRef.current = true;
        console.log(`[WebRTC ${CUID_SHORT} startCall (Caller)]: Creating offer directly...`);
        try {
          const offer = await pc.createOffer();
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) in startCall]:`, offer.sdp?.substring(0,100)+"...");
          if (pc.signalingState !== 'stable') {
             console.warn(`[WebRTC ${CUID_SHORT} startCall (Caller)]: Signaling state changed to ${pc.signalingState} before setLocalDescription(offer). Aborting.`);
             makingOffer.current = false; isNegotiatingRef.current = false; return;
          }
          await pc.setLocalDescription(offer);
          if (roomId && currentUserId && remoteUserId && pc.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Offer sent.`);
          }
        } catch (err) {
           console.error(`[WebRTC ${CUID_SHORT} startCall (Caller)]: Error creating/sending offer:`, err);
           isNegotiatingRef.current = false;
        } finally {
           makingOffer.current = false;
        }
      } else {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Not in state to create offer. State: ${pc.signalingState}, makingOffer: ${makingOffer.current}, isNegotiating: ${isNegotiatingRef.current}`);
      }
    }
  }, [setupLocalStream, createPeerConnection, CUID_SHORT, roomId, remoteUserId, currentUserId]);

  // Firestore Signal Listener
  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
      console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping. Room: ${roomId}, Remote: ${remoteUserId}, Current: ${currentUserId}`);
      return;
    }
    
    let currentPC = peerConnectionRef.current;
    if (!currentPC || currentPC.signalingState === "closed") {
      console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: PC is null or closed for room ${roomId}. Creating new PC (likely for callee or reconnection).`);
      currentPC = createPeerConnection();
      if (!currentPC) {
        console.error(`[WebRTC ${CUID_SHORT}] Signaling listener: Failed to create peer connection for incoming signals.`);
        return;
      }
    }
    console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, for signals from ${remoteUserId}. PC State: ${currentPC.signalingState}`);

    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const pcInstance = peerConnectionRef.current; // Use the latest ref
      if (!pcInstance || pcInstance.signalingState === 'closed') {
        console.warn(`[WebRTC ${CUID_SHORT}] Received signal type ${signal.type} but PC is null/closed. Ignoring.`);
        return;
      }

      console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${pcInstance.signalingState}, isNegotiatingRef: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}, politePeer: ${politePeer.current}`);

      try {
        if (signal.type === 'offer') {
          const offerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, offerSdp.substring(0, 100) + "...");
          
          const offerCollision = makingOffer.current || (pcInstance.signalingState !== "stable" && !politePeer.current);
          
          if (offerCollision) {
            ignoreOffer.current = politePeer.current; // Polite peer yields
            if (ignoreOffer.current) {
              console.warn(`[WebRTC ${CUID_SHORT} Polite Peer] Glare: Received offer while making one or not stable. Ignoring incoming offer.`); 
              return; 
            }
            // Impolite peer (or no collision initially) proceeds, but might need to rollback if it sent an offer.
            // This is complex. A common strategy is for the impolite peer to set a flag that it needs to resend its offer
            // once the current negotiation (answering the incoming offer) is stable.
            // For now, if it's not ignoring, it will try to process.
            console.warn(`[WebRTC ${CUID_SHORT} Impolite Peer/Race] Glare: Received offer. MakingOffer=${makingOffer.current}, State=${pcInstance.signalingState}. Proceeding to set remote.`);
          }
          
          isNegotiatingRef.current = true;
          await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Callee] Remote description (offer) set. Current pc.signalingState: ${pcInstance.signalingState}`);
          
          // Ensure local stream is ready and tracks are on senders before creating answer
          const streamForAnswer = await setupLocalStream(); 
          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Local stream setup failed. Cannot create answer.`);
            isNegotiatingRef.current = false; return;
          }
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before creating answer:`, pcInstance.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
          
          const answer = await pcInstance.createAnswer();
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local)]:`, answer.sdp?.substring(0,100)+"...");
          
          if (pcInstance.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] State is ${pcInstance.signalingState} before setLocalDescription(answer). Aborting answer.`);
             isNegotiatingRef.current = false; return;
          }
          await pcInstance.setLocalDescription(answer);
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local description (answer) set. New state: ${pcInstance.signalingState}`);

          if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: pcInstance.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT} Callee] Answer sent.`);
          }
          // isNegotiatingRef.current will be set to false when signalingState becomes 'stable'

        } else if (signal.type === 'answer') {
          const answerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, answerSdp.substring(0,100)+"...");
          if (pcInstance.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${pcInstance.signalingState}. Ignoring.`); 
            return;
          }
          // isNegotiatingRef.current should already be true if we sent an offer
          await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${pcInstance.signalingState}`);
          // isNegotiatingRef.current will be set to false when signalingState becomes 'stable'

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (pcInstance.remoteDescription) { 
            try {
              console.log(`[WebRTC ${CUID_SHORT}] Adding received ICE candidate: type=${(signal.candidate as RTCIceCandidateInit).type}`);
              await pcInstance.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
            } catch (e) {
               if (!ignoreOffer.current) { // Only log error if not actively ignoring offers (and thus their candidates)
                 console.warn(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e);
               }
            }
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set on PC instance (state: ${pcInstance.signalingState}). Candidate might be queued by browser. Candidate:`, signal.candidate);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
        // Reset negotiation flags on error to allow recovery
        isNegotiatingRef.current = false; 
        makingOffer.current = false; 
        ignoreOffer.current = false;
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}.`);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream, associateTracksWithSenders]); 

  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called.`);
    const currentPC = peerConnectionRef.current;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      onLocalStream(null); 
      console.log(`[WebRTC ${CUID_SHORT}] Local stream stopped and cleared.`);
    }
    if (currentPC) {
      // Detach all event handlers
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
      console.log(`[WebRTC ${CUID_SHORT}] PeerConnection cleared from ref.`);
    }
    onRemoteStream(null); 
    // Reset all state flags
    isNegotiatingRef.current = false; 
    makingOffer.current = false;
    ignoreOffer.current = false;
    politePeer.current = false; // Reset politeness
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  // Store roomId in a ref to access its latest value in cleanup
  const roomIdRef = useRef(roomId);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // Effect to run cleanup when the component unmounts or critical IDs change
  useEffect(() => {
    // This effect's cleanup function will be called when dependencies change or component unmounts
    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Unmount/dependency change effect for cleanup. Current RoomIdRef: ${roomIdRef.current}`);
      if (peerConnectionRef.current) { // If there's an active connection, clean it up
         cleanup();
      }
    };
  }, [cleanup]); // Make sure cleanup is stable or correctly memoized

  return { 
    peerConnection: peerConnectionRef, 
    startCall, 
    cleanup, 
    setupLocalStream 
  };
}

    

      
"use client";

import { useEffect, useCallback, useRef, useState } from 'react';
import * as FirestoreService from '@/lib/firestore-service';
import type { SignalPayload } from '@/types';

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
  
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const isNegotiatingRef = useRef(false); // Tracks if a negotiation (offer/answer/ICE) is active
  const politePeer = useRef(false); // True if this peer should yield in case of glare
  const transceiversAddedRef = useRef(false); // Tracks if initial audio/video transceivers have been added

  const CUID_SHORT = currentUserId?.substring(0, 5) || 'anon';

  const associateTracksWithSenders = useCallback(async (pc: RTCPeerConnection, stream: MediaStream) => {
    console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Associating tracks from stream ${stream.id.substring(0,5)} to PC ${pc.signalingState}`);
    const senders = pc.getSenders();
    
    for (const track of stream.getTracks()) {
      let sender = senders.find(s => s.track?.kind === track.kind);
      if (sender) {
        if (sender.track !== track) {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing ${track.kind} track on existing sender.`);
          await sender.replaceTrack(track).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing ${track.kind} track:`, e));
        }
      } else {
        // This case should be rare if transceivers are added first,
        // but as a fallback or for initial track addition if transceivers weren't fully set up.
        try {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No sender for ${track.kind}, attempting addTrack.`);
          pc.addTrack(track, stream);
        } catch (e) {
          console.error(`[WebRTC ${CUID_SHORT}] Error adding ${track.kind} track in associateTracksWithSenders:`, e);
        }
      }
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after associateTracksWithSenders:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
  }, [CUID_SHORT]);


  const createPeerConnection = useCallback(async () => {
    if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
      console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Re-using existing PC instance (state: ${peerConnectionRef.current.signalingState}).`);
      return peerConnectionRef.current;
    }

    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}. Polite: ${politePeer.current}`);
    
    let iceServersFromApi: RTCIceServer[] = [];
    let fetchError = null;

    try {
      console.log(`[WebRTC ${CUID_SHORT}] Fetching ICE server configuration...`);
      const response = await fetch("https://anonchatter.metered.live/api/v1/turn/credentials?apiKey=08f5bcd1b06f48f177fc3842e3caff0ea7a4");
      if (response.ok) {
        iceServersFromApi = await response.json();
        if (!Array.isArray(iceServersFromApi)) { // Ensure it's an array
            console.warn(`[WebRTC ${CUID_SHORT}] Fetched ICE servers response was not an array. Using STUN only. Response:`, iceServersFromApi);
            iceServersFromApi = [];
        }
      } else {
        fetchError = new Error(`Failed to fetch ICE servers. Status: ${response.status}`);
        console.error(`[WebRTC ${CUID_SHORT}]`, fetchError.message);
      }
    } catch (error) {
      fetchError = error instanceof Error ? error : new Error(String(error));
      console.error(`[WebRTC ${CUID_SHORT}] Error fetching ICE servers:`, fetchError.message);
    }

    let defaultStunServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    
    let finalIceServers = [...defaultStunServers];

    if (iceServersFromApi && iceServersFromApi.length > 0) {
      console.log(`[WebRTC ${CUID_SHORT}] Fetched ICE Servers from API (before filtering):`, JSON.stringify(iceServersFromApi));
      
      const problematicStunPatterns = [
        "stun:standard.relay.metered.ca:80",
        "stun:standard.relay.metered.ca:443" 
      ];

      const filteredApiIceServers = iceServersFromApi.filter(server => {
        let serverUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const validUrls = serverUrls.filter(url => {
          if (typeof url !== 'string') { // Ensure URL is a string before calling startsWith
            console.warn(`[WebRTC ${CUID_SHORT}] Encountered non-string URL in ICE server config:`, url, server);
            return false; 
          }
          const isProblematic = problematicStunPatterns.some(pattern => url.startsWith(pattern));
          if (isProblematic) {
            console.log(`[WebRTC ${CUID_SHORT}] Filtering out problematic STUN url: ${url} from server config:`, server);
          }
          return !isProblematic;
        });
        
        if (validUrls.length === 0 && serverUrls.length > 0) return false; 
        server.urls = validUrls.length === 1 ? validUrls[0] : validUrls; 
        return validUrls.length > 0;
      });
      
      console.log(`[WebRTC ${CUID_SHORT}] Fetched ICE Servers from API (after filtering):`, JSON.stringify(filteredApiIceServers));
      finalIceServers = [...finalIceServers, ...filteredApiIceServers];
    } else if (fetchError) {
      console.warn(`[WebRTC ${CUID_SHORT}] Using only default STUN servers due to API fetch error.`);
    } else {
      console.warn(`[WebRTC ${CUID_SHORT}] API returned no valid ICE servers or did not error. Using only default STUN servers.`);
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] Final ICE Servers for PeerConnection:`, JSON.stringify(finalIceServers));
    const pcInstance = new RTCPeerConnection({ iceServers: finalIceServers });
    peerConnectionRef.current = pcInstance;
    transceiversAddedRef.current = false; 

    // Add transceivers for audio and video if not already present from a previous setup on this PC instance
    // This ensures m-line slots are established early.
    if (!transceiversAddedRef.current) {
        // Check if an audio transceiver/sender already exists (e.g. from a previous connection attempt that failed partially)
        if (!pcInstance.getSenders().find(s => (s.track && s.track.kind === 'audio') || (s.receiver && s.receiver.track && s.receiver.track.kind === 'audio'))) {
          pcInstance.addTransceiver('audio', { direction: 'sendrecv' });
          console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added initial audio transceiver.`);
        }
        if (!pcInstance.getSenders().find(s => (s.track && s.track.kind === 'video') || (s.receiver && s.receiver.track && s.receiver.track.kind === 'video'))) {
          pcInstance.addTransceiver('video', { direction: 'sendrecv' });
          console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added initial video transceiver.`);
        }
        transceiversAddedRef.current = true;
    }


    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        const cand = event.candidate.toJSON();
        console.log(`[WebRTC ${CUID_SHORT}] ICE candidate gathered: type=${cand.type}, address=${cand.address}, protocol=${cand.protocol}, relatedAddress=${cand.relatedAddress}, relatedPort=${cand.relatedPort}, sdpMid=${cand.sdpMid}, sdpMLineIndex=${cand.sdpMLineIndex}`);
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: cand });
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
        console.log(`[WebRTC ${CUID_SHORT}] Remote Stream 0 (ID: ${event.streams[0].id.substring(0,5)}): Active=${event.streams[0].active}, Tracks:`, event.streams[0].getTracks().map(t=>({kind:t.kind, id: t.id.substring(0,5), muted: t.muted, enabled: t.enabled, readyState: t.readyState})));
        onRemoteStream(event.streams[0]);
      } else if (event.track) {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] undefined. Creating new stream with track: Kind=${event.track.kind}, ID=${event.track.id.substring(0,5)}`);
        const newStream = new MediaStream([event.track]);
        onRemoteStream(newStream);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: No streams and no track in event.`);
        onRemoteStream(null);
      }
    };

    pcInstance.onnegotiationneeded = async () => {
      const currentPC = peerConnectionRef.current; // Use current value from ref
      if (!currentPC || isNegotiatingRef.current || makingOffer.current || currentPC.signalingState !== 'stable') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING. Conditions: isNegotiatingRef=${isNegotiatingRef.current}, makingOffer=${makingOffer.current}, signalingState=${currentPC?.signalingState}`);
        return;
      }
      if (politePeer.current && currentPC.remoteDescription && currentPC.remoteDescription.type === 'offer') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Polite peer has remote offer, should be answering, not offering. SKIPPING.`);
        return;
      }

      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite peer: ${politePeer.current}. Current PC Senders:`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
        
        if (localStreamRef.current) {
          await associateTracksWithSenders(currentPC, localStreamRef.current);
        }

        const offer = await currentPC.createOffer();
        const offerSdpForLog = offer.sdp ? offer.sdp.substring(0, 100) + "..." : "N/A";
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) by onnegotiationneeded]:`, offerSdpForLog);
        
        if (currentPC.signalingState !== 'stable') { 
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state changed to ${currentPC.signalingState} before setLocalDescription(offer). Aborting offer.`);
          makingOffer.current = false; 
          isNegotiatingRef.current = false;
          return;
        }
        await currentPC.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: pc.setLocalDescription(offer) SUCCEEDED. New state: ${currentPC.signalingState}`);
        
        if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
          FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: currentPC.localDescription.sdp });
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error creating/sending offer:`, err);
        isNegotiatingRef.current = false;
      } finally {
        makingOffer.current = false;
        // isNegotiatingRef is reset when signalingState becomes 'stable' or explicitly after an operation
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
        const newSignalingState = peerConnectionRef.current.signalingState;
        console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${newSignalingState}`);
        if (newSignalingState === 'stable') {
          console.log(`[WebRTC ${CUID_SHORT}] Signaling state is STABLE. Resetting isNegotiatingRef.`);
          isNegotiatingRef.current = false;
        }
      }
    };
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT, associateTracksWithSenders]);

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Re-using active local stream. ID: ${localStreamRef.current.id.substring(0,5)}`);
      onLocalStream(localStreamRef.current);
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed' && localStreamRef.current) {
        await associateTracksWithSenders(pc, localStreamRef.current);
      }
      return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id.substring(0,5)}`);
      stream.getTracks().forEach(track => {
        console.log(`[WebRTC ${CUID_SHORT}] Local Track Details: kind=${track.kind}, id=${track.id.substring(0,5)}, label=${track.label.substring(0,10)}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });
      
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are updated/added.`);
        await associateTracksWithSenders(pc, stream);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] setupLocalStream (new stream): PC does not exist or is closed. Tracks will be associated when PC is created/call starts.`);
      }
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] setupLocalStream: Error accessing media devices.`, error);
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, CUID_SHORT, associateTracksWithSenders]);

  const startCall = useCallback(async (isCallerFlag: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}. RoomID: ${roomId}, RemoteUID: ${remoteUserId}`);
    politePeer.current = !isCallerFlag; 

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: No/Closed PC, creating new one.`);
      pc = await createPeerConnection(); 
      if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    } else {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Existing PC found. State: ${pc.signalingState}`);
    }
        
    if (!localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream not active, attempting setupLocalStream.`);
      const stream = await setupLocalStream(); 
      if (!stream) {
        console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream after PC creation. Aborting.`);
        return;
      }
    } else if (localStreamRef.current && pc.signalingState !== 'closed') { // Ensure PC is not closed
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream already active. Ensuring tracks are associated with PC (state: ${pc.signalingState}).`);
      await associateTracksWithSenders(pc, localStreamRef.current);
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after setupLocalStream in startCall:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
    
    if (isCallerFlag && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC state is stable. Forcing offer via onnegotiationneeded trigger simulation or direct call.`);
        makingOffer.current = true; // Set before potential async operation
        isNegotiatingRef.current = true;
        try {
            // Explicitly associate tracks again right before offer if they might not have been set on this specific PC instance yet.
            if (localStreamRef.current) {
                await associateTracksWithSenders(pc, localStreamRef.current);
            }
            const offer = await pc.createOffer();
            const offerSdpForLog = offer.sdp ? offer.sdp.substring(0, 100) + "..." : "N/A";
            console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) in startCall - forced]:`, offerSdpForLog);
            if (pc.signalingState !== 'stable') { 
                console.warn(`[WebRTC ${CUID_SHORT} startCall (Caller) - forced]: Signaling state changed to ${pc.signalingState} before setLocalDescription(offer). Aborting.`);
                makingOffer.current = false; isNegotiatingRef.current = false; return;
            }
            await pc.setLocalDescription(offer);
            console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller) - forced: pc.setLocalDescription(offer) SUCCEEDED. New state: ${pc.signalingState}`);
            if (roomId && currentUserId && remoteUserId && pc.localDescription) {
                FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
                console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller) - forced: Offer sent.`);
            }
        } catch (err) {
           console.error(`[WebRTC ${CUID_SHORT} startCall (Caller) - forced]: Error creating/sending offer:`, err);
           isNegotiatingRef.current = false; // Reset on error
        } finally {
           makingOffer.current = false;
           // isNegotiatingRef will be reset by signalingStateChange to 'stable' or if another error occurs
        }
    } else if (isCallerFlag) {
         console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Not triggering offer directly. Waiting for onnegotiationneeded or state change. State: ${pc.signalingState}, makingOffer: ${makingOffer.current}, isNegotiating: ${isNegotiatingRef.current}`);
    }

  }, [setupLocalStream, createPeerConnection, CUID_SHORT, roomId, remoteUserId, currentUserId, associateTracksWithSenders]);

  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
      console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping. RoomId: ${roomId}, RemoteId: ${remoteUserId}, CurrentId: ${currentUserId}`);
      return;
    }
    
    let unsubscribeFirestore: (() => void) | null = null;

    const setupSignalListener = async () => {
      let currentPC = peerConnectionRef.current;
      if (!currentPC || currentPC.signalingState === "closed") {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener: PC is null or closed for room ${roomId}. Attempting to create new PC.`);
        currentPC = await createPeerConnection(); 
        if (!currentPC) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener: Failed to create peer connection for incoming signals.`);
          return; // Exit if PC creation failed
        }
      }
      console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, for signals from ${remoteUserId}. PC State: ${currentPC.signalingState}`);

      unsubscribeFirestore = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
        const pcInstance = peerConnectionRef.current; 
        if (!pcInstance || pcInstance.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal type ${signal.type} but PC is null/closed. Ignoring.`);
          return;
        }

        console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${pcInstance.signalingState}, isNegotiatingRef: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}, politePeer: ${politePeer.current}`);

        try {
          if (signal.type === 'offer') {
            const offerSdp = signal.sdp!;
            const offerSdpForLog = offerSdp.substring(0, 100) + "...";
            console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, offerSdpForLog);
            
            const offerCollision = makingOffer.current || (pcInstance.signalingState !== "stable" && !politePeer.current);
            ignoreOffer.current = politePeer.current && offerCollision;
            
            if (ignoreOffer.current) {
              console.warn(`[WebRTC ${CUID_SHORT} Polite Peer] Glare: Received offer while making one or not stable. Ignoring incoming offer.`); 
              return; 
            }
            
            isNegotiatingRef.current = true;
            await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
            console.log(`[WebRTC ${CUID_SHORT} Callee] Remote description (offer) set. Current pc.signalingState: ${pcInstance.signalingState}`);
            
            let streamForAnswer = localStreamRef.current;
            if (!streamForAnswer?.active) {
                console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready or inactive. Setting up...`);
                streamForAnswer = await setupLocalStream(); 
                if (!streamForAnswer) {
                    console.error(`[WebRTC ${CUID_SHORT} Callee] Local stream setup failed. Cannot create answer.`);
                    isNegotiatingRef.current = false; return;
                }
            } else {
                 console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream active. Ensuring tracks are associated.`);
                 await associateTracksWithSenders(pcInstance, streamForAnswer);
            }
            console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before creating answer:`, pcInstance.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
            
            const answer = await pcInstance.createAnswer();
            const answerSdpForLog = answer.sdp ? answer.sdp.substring(0, 100) + "..." : "N/A";
            console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local)]:`, answerSdpForLog);
            
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
            // isNegotiatingRef is reset when signalingState becomes 'stable'

          } else if (signal.type === 'answer') {
            const answerSdp = signal.sdp!;
            const answerSdpForLog = answerSdp.substring(0, 100) + "...";
            console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, answerSdpForLog);
            if (pcInstance.signalingState !== 'have-local-offer') {
              console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${pcInstance.signalingState}. Ignoring.`); 
              return;
            }
            await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
            console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${pcInstance.signalingState}`);
            // isNegotiatingRef is reset when signalingState becomes 'stable'

          } else if (signal.type === 'candidate' && signal.candidate) {
            if (pcInstance.remoteDescription) { 
              try {
                console.log(`[WebRTC ${CUID_SHORT}] Adding received ICE candidate: type=${(signal.candidate as RTCIceCandidateInit).type}`);
                await pcInstance.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
              } catch (e) {
                 if (!ignoreOffer.current) { 
                   console.warn(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e);
                 }
              }
            } else {
              console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set on PC instance (state: ${pcInstance.signalingState}). Candidate might be queued by browser. Candidate:`, signal.candidate);
            }
          }
        } catch (error) {
          console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
          isNegotiatingRef.current = false; 
          makingOffer.current = false; 
          ignoreOffer.current = false;
        }
      });
    };
    
    setupSignalListener();
    
    return () => {
      if (unsubscribeFirestore) {
        console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}.`);
        unsubscribeFirestore();
      }
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, setupLocalStream, CUID_SHORT, associateTracksWithSenders]); 

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
      transceiversAddedRef.current = false; 
      console.log(`[WebRTC ${CUID_SHORT}] PeerConnection reference cleared.`);
    }
    onRemoteStream(null); 
    isNegotiatingRef.current = false; 
    makingOffer.current = false;
    ignoreOffer.current = false;
    politePeer.current = false; 
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  const currentRoomIdRef = useRef(roomId);
  useEffect(() => {
    currentRoomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    // This effect is for unmounting the hook itself or if critical IDs change
    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Unmount/dependency change effect in useWebRTCSignaling. Triggering cleanup for room: ${currentRoomIdRef.current}.`);
      if (peerConnectionRef.current) { 
         cleanup();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CUID_SHORT]); // cleanup is stable due to useCallback with stable deps

  return { 
    peerConnection: peerConnectionRef, 
    startCall, 
    cleanup, 
    setupLocalStream 
  };
}

    
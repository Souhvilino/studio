
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
  const isNegotiatingRef = useRef(false);
  const politePeer = useRef(false);
  const transceiversAddedRef = useRef(false); // Tracks if initial audio/video transceivers have been added for the current PC instance

  const CUID_SHORT = currentUserId?.substring(0, 5) || 'anon';

  const associateTracksWithSenders = useCallback(async (pc: RTCPeerConnection, stream: MediaStream) => {
    console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Associating tracks from stream ${stream.id.substring(0,5)} to PC ${pc.signalingState}`);
    
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === 'audio') {
        if (audioTrack && sender.track !== audioTrack) {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing audio track on sender.`);
          await sender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing audio track:`, e));
        } else if (!audioTrack && sender.track) { // No new audio track, but sender has one, remove it
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Removing audio track from sender (no new track).`);
          await sender.replaceTrack(null).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error removing audio track:`, e));
        }
      } else if (sender.track?.kind === 'video') {
        if (videoTrack && sender.track !== videoTrack) {
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing video track on sender.`);
          await sender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing video track:`, e));
        } else if (!videoTrack && sender.track) { // No new video track, but sender has one, remove it
          console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Removing video track from sender (no new track).`);
          await sender.replaceTrack(null).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error removing video track:`, e));
        }
      }
    }
    // If after replacing, there are still no senders for a track that exists in the stream, add it.
    // This handles the case where transceivers were added but replaceTrack(null) might have cleared the sender's track.
    if (audioTrack && !pc.getSenders().find(s => s.track === audioTrack)) {
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio' || (!s.track && s.kind === 'audio')); // find an untracked audio sender
        if (audioSender) {
            console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Found existing audio sender without track, replacing with new audio track.`);
            await audioSender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error setting audio track on existing sender:`, e));
        } else {
           // This should not happen if transceivers are added correctly initially
           console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No audio sender found, attempting addTrack (should be rare).`);
           try { pc.addTrack(audioTrack, stream); } catch(e) { console.error(`[WebRTC ${CUID_SHORT}] Error adding audio track in associate:`, e); }
        }
    }
    if (videoTrack && !pc.getSenders().find(s => s.track === videoTrack)) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video' || (!s.track && s.kind === 'video'));
        if (videoSender) {
            console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Found existing video sender without track, replacing with new video track.`);
            await videoSender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error setting video track on existing sender:`, e));
        } else {
            console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: No video sender found, attempting addTrack (should be rare).`);
            try { pc.addTrack(videoTrack, stream); } catch(e) { console.error(`[WebRTC ${CUID_SHORT}] Error adding video track in associate:`, e); }
        }
    }

    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after associateTracksWithSenders:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
  }, [CUID_SHORT]);

  const createPeerConnection = useCallback(async () => {
    if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Re-using existing PC instance (state: ${peerConnectionRef.current.signalingState}).`);
        return peerConnectionRef.current;
    }
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs. Room: ${roomId}, CurrentUser: ${currentUserId}, RemoteUser: ${remoteUserId}`);
      return null;
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}. Polite: ${politePeer.current}`);
    
    let iceServersConfig = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    try {
      console.log(`[WebRTC ${CUID_SHORT}] Fetching ICE server configuration...`);
      const response = await fetch("https://anonchatter.metered.live/api/v1/turn/credentials?apiKey=08f5bcd1b06f48f177fc3842e3caff0ea7a4");
      if (response.ok) {
        const fetchedIceServers = await response.json();
        if (Array.isArray(fetchedIceServers) && fetchedIceServers.length > 0) {
          iceServersConfig = [...iceServersConfig, ...fetchedIceServers];
          console.log(`[WebRTC ${CUID_SHORT}] Successfully fetched ICE servers. Using combined config.`);
        } else {
          console.warn(`[WebRTC ${CUID_SHORT}] Fetched ICE servers response was empty or not an array. Using STUN only.`);
        }
      } else {
        console.error(`[WebRTC ${CUID_SHORT}] Failed to fetch ICE servers. Status: ${response.status}. Using STUN only.`);
      }
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] Error fetching ICE servers:`, error, ". Using STUN only.");
    }

    const pcInstance = new RTCPeerConnection({ iceServers: iceServersConfig });
    peerConnectionRef.current = pcInstance;
    transceiversAddedRef.current = false; 

    if (!transceiversAddedRef.current) {
        pcInstance.addTransceiver('audio', { direction: 'sendrecv' });
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added initial audio transceiver.`);
        pcInstance.addTransceiver('video', { direction: 'sendrecv' });
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added initial video transceiver.`);
        transceiversAddedRef.current = true;
    }


    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        const cand = event.candidate.toJSON();
        console.log(`[WebRTC ${CUID_SHORT}] ICE candidate gathered: type=${cand.type}, address=${cand.address}, protocol=${cand.protocol}, relatedAddress=${cand.relatedAddress}, relatedPort=${cand.relatedPort}`);
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
      if (event.streams && event.streams[0]) {
        console.log(`[WebRTC ${CUID_SHORT}] Remote Stream 0 (ID: ${event.streams[0].id.substring(0,5)}): Active=${event.streams[0].active}, Tracks:`, event.streams[0].getTracks().map(t=>({kind:t.kind, id: t.id.substring(0,5)})));
        onRemoteStream(event.streams[0]);
      } else if (event.track) {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] undefined. Creating new stream with track: Kind=${event.track.kind}, ID=${event.track.id.substring(0,5)}`);
        const newStream = new MediaStream([event.track]); // Create stream with track directly
        onRemoteStream(newStream);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: No streams and no track in event.`);
        onRemoteStream(null);
      }
      event.track.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track MUTED: ${event.track.id.substring(0,5)}`);
      event.track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track UNMUTED: ${event.track.id.substring(0,5)}`);
    };

    pcInstance.onnegotiationneeded = async () => {
      const currentPC = peerConnectionRef.current;
      if (!currentPC || isNegotiatingRef.current || makingOffer.current || currentPC.signalingState !== 'stable') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING due to state. isNegotiatingRef=${isNegotiatingRef.current}, makingOffer=${makingOffer.current}, signalingState=${currentPC?.signalingState}`);
        return;
      }
      if (politePeer.current && currentPC.remoteDescription && currentPC.remoteDescription.type === 'offer') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Polite peer has remote offer, should be answering. SKIPPING offer creation.`);
        return;
      }

      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite: ${politePeer.current}. PC Senders:`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
        
        if (localStreamRef.current) {
            await associateTracksWithSenders(currentPC, localStreamRef.current);
        }

        const offer = await currentPC.createOffer();
        const offerSdpForLog = offer.sdp ? offer.sdp.substring(0, 150) + "..." : "N/A";
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) by onnegotiationneeded]:`, offerSdpForLog);
        
        // Double check state before setting local description
        if (currentPC.signalingState !== 'stable') { 
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state became ${currentPC.signalingState} before setLocalDescription(offer). Aborting offer.`);
          makingOffer.current = false; 
          isNegotiatingRef.current = false; // Reset negotiation state
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
        isNegotiatingRef.current = false; // Reset on error
      } finally {
        makingOffer.current = false;
        // isNegotiatingRef is typically reset when signalingState becomes stable or explicitly after an operation
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
      onLocalStream(localStreamRef.current); // Notify parent
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
      onLocalStream(stream); // Notify parent
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id.substring(0,5)}, Tracks:`, stream.getTracks().map(t => ({kind: t.kind, id: t.id.substring(0,5), label: t.label.substring(0,10), enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        await associateTracksWithSenders(pc, stream);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] setupLocalStream (new stream): PC does not exist or is closed. Tracks will be associated when PC is created/call starts.`);
      }
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] setupLocalStream: Error accessing media devices.`, error);
      onLocalStream(null); // Notify parent of failure
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
      await setupLocalStream(); // setupLocalStream will call associateTracksWithSenders
      if (!localStreamRef.current) { // Check if setupLocalStream failed
        console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting.`);
        return;
      }
    } else { // Stream exists, ensure tracks are on this PC instance
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream already active. Ensuring tracks are associated with PC (state: ${pc.signalingState}).`);
        await associateTracksWithSenders(pc, localStreamRef.current);
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after setupLocalStream in startCall:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
    
    if (isCallerFlag && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC state is stable. Manually triggering offer.`);
        makingOffer.current = true;
        isNegotiatingRef.current = true;
        try {
            const offer = await pc.createOffer();
            const offerSdpForLog = offer.sdp ? offer.sdp.substring(0, 150) + "..." : "N/A";
            console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) in startCall - forced]:`, offerSdpForLog);
            if (pc.signalingState !== 'stable') { 
                console.warn(`[WebRTC ${CUID_SHORT} startCall (Caller) - forced]: Signaling state changed to ${pc.signalingState} before setLocalDescription(offer). Aborting.`);
                makingOffer.current = false; isNegotiatingRef.current = false; return;
            }
            await pc.setLocalDescription(offer);
            if (roomId && currentUserId && remoteUserId && pc.localDescription) {
                FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
                console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller) - forced: Offer sent.`);
            }
        } catch (err) {
           console.error(`[WebRTC ${CUID_SHORT} startCall (Caller) - forced]: Error creating/sending offer:`, err);
           isNegotiatingRef.current = false;
        } finally {
           makingOffer.current = false;
        }
    } else if (isCallerFlag) {
         console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Not triggering offer directly. Waiting for onnegotiationneeded or state change. State: ${pc.signalingState}, makingOffer: ${makingOffer.current}, isNegotiating: ${isNegotiatingRef.current}`);
    }

  }, [setupLocalStream, createPeerConnection, CUID_SHORT, roomId, remoteUserId, currentUserId]);

  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
      console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping. RoomId: ${roomId}, RemoteId: ${remoteUserId}, CurrentId: ${currentUserId}`);
      return;
    }
    
    const setupListener = async () => {
      let currentPC = peerConnectionRef.current;
      if (!currentPC || currentPC.signalingState === "closed") {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener: PC is null or closed for room ${roomId}. Creating new PC as part of listener setup.`);
        currentPC = await createPeerConnection(); 
        if (!currentPC) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener: Failed to create peer connection for incoming signals.`);
          return () => {};
        }
      }
      console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, for signals from ${remoteUserId}. PC State: ${currentPC.signalingState}`);

      const unsubscribeFirestore = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
        const pcInstance = peerConnectionRef.current; 
        if (!pcInstance || pcInstance.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal type ${signal.type} but PC is null/closed. Ignoring.`);
          return;
        }

        console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${pcInstance.signalingState}, isNegotiatingRef: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}, politePeer: ${politePeer.current}`);

        try {
          if (signal.type === 'offer') {
            const offerSdp = signal.sdp!;
            const offerSdpForLog = offerSdp.substring(0, 150) + "...";
            console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, offerSdpForLog);
            
            const offerCollision = makingOffer.current || (pcInstance.signalingState !== "stable" && !politePeer.current); // Making an offer OR not stable AND not polite (impolite and not stable)
            ignoreOffer.current = politePeer.current && offerCollision; // Polite peer ignores if collision
            
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
                streamForAnswer = await setupLocalStream(); // This will also call associateTracksWithSenders
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
            const answerSdpForLog = answer.sdp ? answer.sdp.substring(0, 150) + "..." : "N/A";
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
            isNegotiatingRef.current = false;

          } else if (signal.type === 'answer') {
            const answerSdp = signal.sdp!;
            const answerSdpForLog = answerSdp.substring(0, 150) + "...";
            console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, answerSdpForLog);
            if (pcInstance.signalingState !== 'have-local-offer') {
              console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${pcInstance.signalingState}. Ignoring.`); 
              return;
            }
            await pcInstance.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
            console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${pcInstance.signalingState}`);
            isNegotiatingRef.current = false;

          } else if (signal.type === 'candidate' && signal.candidate) {
            if (pcInstance.remoteDescription) { 
              try {
                console.log(`[WebRTC ${CUID_SHORT}] Adding received ICE candidate: type=${(signal.candidate as RTCIceCandidateInit).type}`);
                await pcInstance.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
              } catch (e) {
                 if (!ignoreOffer.current) { // Only log error if not ignoring an offer (as candidates might be for that ignored offer)
                   console.warn(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e);
                 }
              }
            } else {
              console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set on PC instance (state: ${pcInstance.signalingState}). Candidate might be queued by browser. Candidate type: ${(signal.candidate as RTCIceCandidateInit)?.type}`);
            }
          }
        } catch (error) {
          console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
          // Reset negotiation flags on any error during signal handling
          isNegotiatingRef.current = false; 
          makingOffer.current = false; 
          ignoreOffer.current = false;
        }
      });
      return () => {
        console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}.`);
        unsubscribeFirestore();
      };
    };
    
    const unsubscribePromise = setupListener();
    return () => {
      unsubscribePromise.then(unsub => unsub && unsub());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, remoteUserId, currentUserId]); // createPeerConnection, setupLocalStream, associateTracksWithSenders are stable due to useCallback

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
    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Unmount/dependency change effect in useWebRTCSignaling. Triggering cleanup for room: ${currentRoomIdRef.current}.`);
      if (peerConnectionRef.current) { 
         cleanup();
      }
    };
  }, [cleanup, CUID_SHORT]);

  return { 
    peerConnection: peerConnectionRef, 
    startCall, 
    cleanup, 
    setupLocalStream 
  };
}

    

"use client";

import { useEffect, useCallback, useRef, useState } from 'react';
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
  
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false); 
  const isNegotiatingRef = useRef(false);


  const CUID_SHORT = currentUserId?.substring(0,5) || 'anon';

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current && localStreamRef.current.active) {
        // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream already exists and is active.`);
        onLocalStream(localStreamRef.current); 
        return localStreamRef.current;
    }
    try {
      // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id}`);
      // stream.getTracks().forEach(track => {
      //   console.log(`[WebRTC ${CUID_SHORT}] Local Track Details: kind=${track.kind}, id=${track.id.substring(0,5)}, label=${track.label}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      // });
      
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        const pc = peerConnectionRef.current;
        // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are added/replaced.`);
        
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (audioSender && audioSender.track) {
            // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Replacing audio track.`);
            // await audioSender.replaceTrack(audioTrack); // replaceTrack can be complex if not fully supported or if transceivers aren't set up as expected.
          } else if (!pc.getSenders().find(s => s.track === audioTrack)) {
            pc.addTrack(audioTrack, stream);
            // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added audio track to existing PC.`);
          }
        }
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender && videoSender.track) {
            // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Replacing video track.`);
            // await videoSender.replaceTrack(videoTrack);
          } else if (!pc.getSenders().find(s => s.track === videoTrack)) {
            pc.addTrack(videoTrack, stream);
            // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added video track to existing PC.`);
          }
        }
        // console.log(`[WebRTC ${CUID_SHORT}] PC Senders after setupLocalStream and PC existed: `, pc.getSenders().map(s => `${s.track?.kind}:${s.track?.id.substring(0,5)}`));
      }
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] setupLocalStream: Error accessing media devices.`, error);
      toast({ title: "Media Error", description: "Could not access camera/microphone. Please check permissions.", variant: "destructive" });
      onLocalStream(null);
      return null;
    }
  }, [onLocalStream, toast, CUID_SHORT]);

  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      // console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs`, {roomId, currentUserId, remoteUserId});
      return null;
    }
    
    if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        // console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Reusing existing PC in state: ${peerConnectionRef.current.signalingState}`);
    } else {
        // console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}`);
        peerConnectionRef.current = new RTCPeerConnection(RTC_CONFIGURATION);
    }
    
    const pcInstance = peerConnectionRef.current;

    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pcInstance.ontrack = (event) => {
      // console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Streams: ${event.streams.length}. Track kind: ${event.track.kind}`);
      // event.streams.forEach((stream, index) => {
      //   console.log(`[WebRTC ${CUID_SHORT}] Remote Stream ${index} (ID: ${stream.id}): Active=${stream.active}`);
      //   stream.getTracks().forEach(t => {
      //     console.log(`  [WebRTC ${CUID_SHORT}] Remote Track: Kind=${t.kind}, ID=${t.id.substring(0,5)}, Label=${t.label}, Enabled=${t.enabled}, Muted=${t.muted}, ReadyState=${t.readyState}`);
      //     t.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${t.kind} track muted: ${t.id.substring(0,5)}`);
      //     t.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${t.kind} track unmuted: ${t.id.substring(0,5)}`);
      //   });
      // });

      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      } else {
        // console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] is undefined. Using event.track to create new stream.`);
        const newStream = new MediaStream([event.track]);
        onRemoteStream(newStream);
      }
    };
    
    pcInstance.onnegotiationneeded = async () => {
      if (makingOffer.current || pcInstance.signalingState !== 'stable' || isNegotiatingRef.current || ignoreOffer.current) {
        // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING, condition not met. State: ${pcInstance.signalingState}, makingOffer: ${makingOffer.current}, isNegotiatingRef: ${isNegotiatingRef.current}, ignoreOffer: ${ignoreOffer.current}`);
        return;
      }
      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... PC Senders:`, pcInstance.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
        
        const offer = await pcInstance.createOffer();
        // console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local)]:`, offer.sdp);
        
        if (pcInstance.signalingState !== 'stable') { 
            //  console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state IS NOT STABLE (${pcInstance.signalingState}) before setLocalDescription(offer). Aborting offer.`);
             makingOffer.current = false;
             isNegotiatingRef.current = false;
             return;
        }
        await pcInstance.setLocalDescription(offer);
        // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: pc.setLocalDescription(offer) SUCCEEDED. New state: ${pcInstance.signalingState}`);

        if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pcInstance.localDescription.sdp });
           // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error during negotiation:`, err);
      } finally {
        makingOffer.current = false;
        isNegotiatingRef.current = false; 
      }
    };
    
    pcInstance.oniceconnectionstatechange = () => {
      // console.log(`[WebRTC ${CUID_SHORT}] ICE connection state: ${pcInstance.iceConnectionState}`);
      onConnectionStateChange?.(pcInstance.iceConnectionState);
    };

    pcInstance.onsignalingstatechange = () => {
        // console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${pcInstance.signalingState}`);
        if (pcInstance.signalingState === 'stable') {
            isNegotiatingRef.current = false;
            ignoreOffer.current = false; 
        }
    };
    
    if (localStreamRef.current?.active) {
      const stream = localStreamRef.current;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && !pcInstance.getSenders().find(s => s.track === audioTrack)) {
          pcInstance.addTrack(audioTrack, stream);
          // console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added audio track.`);
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && !pcInstance.getSenders().find(s => s.track === videoTrack)) {
          pcInstance.addTrack(videoTrack, stream);
          // console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added video track.`);
      }
    }
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT, setupLocalStream]);


  const startCall = useCallback(async (isCallerFlag: boolean) => {
    // console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}. RoomID: ${roomId}, RemoteUID: ${remoteUserId}`);
    
    let stream = localStreamRef.current;
    if (!stream?.active) {
        // console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream not/inactive, calling setupLocalStream.`);
        stream = await setupLocalStream();
    }

    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting.`);
      onConnectionStateChange?.('failed_local_media');
      return;
    }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
        // console.log(`[WebRTC ${CUID_SHORT}] startCall: No/Closed PC, creating new one.`);
        pc = createPeerConnection(); 
        if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack && !pc.getSenders().find(s => s.track === audioTrack)) {
        pc.addTrack(audioTrack, stream);
        // console.log(`[WebRTC ${CUID_SHORT}] startCall: Added audio track.`);
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && !pc.getSenders().find(s => s.track === videoTrack)) {
        pc.addTrack(videoTrack, stream);
        // console.log(`[WebRTC ${CUID_SHORT}] startCall: Added video track.`);
    }
    // console.log(`[WebRTC ${CUID_SHORT}] startCall: Senders after ensuring tracks:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
    
    if (isCallerFlag && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        // console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC is stable. Expecting onnegotiationneeded.`);
        // onnegotiationneeded should fire if tracks were just added or if perfect negotiation is needed.
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange, CUID_SHORT, roomId, remoteUserId]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
        // console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping.`, { roomId, remoteUserId, currentUserId });
        return;
    }

    let pcInstance = peerConnectionRef.current;
    if (!pcInstance || pcInstance.signalingState === 'closed') { 
        // console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: PC is null or closed for room ${roomId}. Creating new PC.`);
        pcInstance = createPeerConnection(); 
        if (!pcInstance) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Failed to create PeerConnection for room ${roomId}. Aborting listener setup.`);
          return;
        }
    }
    
    // console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, for signals from ${remoteUserId}. PC State: ${pcInstance.signalingState}`);
    
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const currentPC = peerConnectionRef.current; 
      if (!currentPC || currentPC.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal but PC is null/closed for room ${roomId}. Ignoring: ${signal.type}`);
          return;
      }
      // console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC state: ${currentPC.signalingState}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}`);
      
      try {
        if (signal.type === 'offer') {
          // console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, signal.sdp);
          if (makingOffer.current || currentPC.signalingState !== 'stable') {
            console.warn(`[WebRTC ${CUID_SHORT}] Glare or unstable: Received offer while making one or not stable. MyState: ${currentPC.signalingState}, MakingOffer: ${makingOffer.current}. Ignoring their offer.`);
            return; 
          }

          isNegotiatingRef.current = true;
          ignoreOffer.current = true; 

          let streamForAnswer = localStreamRef.current;
          if (!streamForAnswer?.active) {
            // console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready. Setting up...`);
            streamForAnswer = await setupLocalStream();
          }

          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Offer received, but local stream setup FAILED. Cannot create answer.`);
            isNegotiatingRef.current = false; ignoreOffer.current = false; 
            return;
          }
          
          const audioTrack = streamForAnswer.getAudioTracks()[0];
          if (audioTrack && !currentPC.getSenders().find(s => s.track === audioTrack)) {
              currentPC.addTrack(audioTrack, streamForAnswer);
              // console.log(`[WebRTC ${CUID_SHORT} Callee] Added audio track before setRemote(offer).`);
          }
          const videoTrack = streamForAnswer.getVideoTracks()[0];
          if (videoTrack && !currentPC.getSenders().find(s => s.track === videoTrack)) {
              currentPC.addTrack(videoTrack, streamForAnswer);
              // console.log(`[WebRTC ${CUID_SHORT} Callee] Added video track before setRemote(offer).`);
          }
          // console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before setRemoteDescription(offer):`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));

          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          // console.log(`[WebRTC ${CUID_SHORT} Callee] Remote description (offer) set. Creating answer...`);
          
          const answer = await currentPC.createAnswer();
          // console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local)]:`, answer.sdp);

          if (currentPC.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] Signaling state IS NOT have-remote-offer (${currentPC.signalingState}) before setLocalDescription(answer). Aborting answer.`);
             isNegotiatingRef.current = false; ignoreOffer.current = false;
             return;
          }
          await currentPC.setLocalDescription(answer);
          // console.log(`[WebRTC ${CUID_SHORT} Callee] Local description (answer) set. New state: ${currentPC.signalingState}`);

          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
            // console.log(`[WebRTC ${CUID_SHORT} Callee] Answer sent.`);
          }
          isNegotiatingRef.current = false; 

        } else if (signal.type === 'answer') {
          // console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, signal.sdp);
           if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${currentPC.signalingState}. Ignoring.`);
            return; 
          }
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          // console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${currentPC.signalingState}`);
          makingOffer.current = false; 
          isNegotiatingRef.current = false; 

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) { 
            try {
              await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
            } catch (e) {
              // console.error(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e);
            }
          } else {
            // console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set. Candidate might be queued by browser.`);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal type ${signal.type} in room ${roomId}:`, error);
        isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false;
      }
    });

    return () => {
      // console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}`);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream]);


  const cleanup = useCallback(async () => {
    // console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room: ${roomIdRef.current}`); // roomIdRef might be stale here if using prop roomId
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null; 
      onLocalStream(null); 
      // console.log(`[WebRTC ${CUID_SHORT}] Local stream stopped and cleared.`);
    }
    if (peerConnectionRef.current) {
      const pc = peerConnectionRef.current;
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.onnegotiationneeded = null;
      
      if (pc.signalingState !== 'closed') {
        pc.close();
      }
      peerConnectionRef.current = null; 
      // console.log(`[WebRTC ${CUID_SHORT}] PeerConnection closed and cleared.`);
    }
    onRemoteStream(null); 
    isNegotiatingRef.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    // Not calling onConnectionStateChange('closed') here directly to avoid potential loops
    // console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  const roomIdRef = useRef(roomId); // Local ref to roomId for cleanup log if needed
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);


  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}


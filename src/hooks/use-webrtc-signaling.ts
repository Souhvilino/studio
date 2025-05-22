
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
  
  const isNegotiatingRef = useRef(false); // Use ref for synchronous checks
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false); // To instruct onnegotiationneeded to ignore if we're handling an incoming offer

  const CUID_SHORT = currentUserId?.substring(0,5) || 'unknown';


  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current && localStreamRef.current.active) {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream already exists and is active.`);
        onLocalStream(localStreamRef.current); 
        return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id}, Tracks:`, stream.getTracks().map(t => `${t.kind}: ${t.label}(${t.id.substring(0,5)})`));
      
      // If PC exists, ensure tracks are (re)added, useful if PC was created before stream
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        const pc = peerConnectionRef.current;
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are added.`);
        
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            if (!pc.getSenders().find(s => s.track === audioTracks[0])) {
                pc.addTrack(audioTracks[0], stream);
                console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added audio track to existing PC.`);
            }
        }
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
            if (!pc.getSenders().find(s => s.track === videoTracks[0])) {
                pc.addTrack(videoTracks[0], stream);
                console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added video track to existing PC.`);
            }
        }
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
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create peer connection, missing IDs`, {roomId, currentUserId, remoteUserId});
      return null;
    }
    
    // If a PC already exists and is not closed, reuse it or clean it up first
    if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Reusing existing PC in state: ${peerConnectionRef.current.signalingState}`);
        // Potentially reset onnegotiationneeded if re-adding tracks might trigger it incorrectly
        // Or ensure it's robust enough. For now, we'll reuse.
    } else {
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}`);
        peerConnectionRef.current = new RTCPeerConnection(RTC_CONFIGURATION);
    }
    
    const pcInstance = peerConnectionRef.current;

    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pcInstance.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Number of streams: ${event.streams.length}. Track kind: ${event.track.kind}, muted: ${event.track.muted}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`);
      event.streams.forEach((stream, index) => {
        console.log(`[WebRTC ${CUID_SHORT}] Remote Stream ${index} (ID: ${stream.id}): Active=${stream.active}, Tracks:`, stream.getTracks().map(t => `${t.kind} (ID: ${t.id.substring(0,5)}, Label: ${t.label}, Enabled: ${t.enabled}, Muted: ${t.muted}, ReadyState: ${t.readyState})`));
        stream.onaddtrack = (e) => console.log(`[WebRTC ${CUID_SHORT}] Track added to remote stream ${stream.id}: ${e.track.kind}`);
        stream.onremovetrack = (e) => console.log(`[WebRTC ${CUID_SHORT}] Track removed from remote stream ${stream.id}: ${e.track.kind}`);
      });

      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      } else {
        // Sometimes tracks arrive individually before streams are fully formed.
        // Create a new MediaStream if necessary.
        const newStream = new MediaStream();
        newStream.addTrack(event.track);
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK event received, no streams[0]. Created new stream with track. Event:`, event);
        onRemoteStream(newStream);
      }
    };
    
    pcInstance.onnegotiationneeded = async () => {
      if (makingOffer.current || pcInstance.signalingState !== 'stable' || isNegotiatingRef.current || ignoreOffer.current) {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING, condition not met. State: ${pcInstance.signalingState}, makingOffer: ${makingOffer.current}, isNegotiatingRef: ${isNegotiatingRef.current}, ignoreOffer: ${ignoreOffer.current}`);
        return;
      }
      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Negotiation needed, creating offer... Current PC Senders:`, pcInstance.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
        
        const offer = await pcInstance.createOffer();
        
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer created. Current pc.signalingState: ${pcInstance.signalingState}`);
        if (pcInstance.signalingState !== 'stable') { 
             console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state IS NOT STABLE (${pcInstance.signalingState}) before setLocalDescription(offer). Aborting offer.`);
             makingOffer.current = false;
             isNegotiatingRef.current = false;
             return;
        }
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state IS STABLE. Attempting pc.setLocalDescription(offer).`);
        await pcInstance.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: pc.setLocalDescription(offer) SUCCEEDED. New state: ${pcInstance.signalingState}`);

        if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pcInstance.localDescription.sdp });
           console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error during negotiation:`, err);
      } finally {
        makingOffer.current = false;
        isNegotiatingRef.current = false; 
      }
    };
    
    pcInstance.oniceconnectionstatechange = () => {
      console.log(`[WebRTC ${CUID_SHORT}] ICE connection state: ${pcInstance.iceConnectionState}`);
      onConnectionStateChange?.(pcInstance.iceConnectionState);
    };

    pcInstance.onsignalingstatechange = () => {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${pcInstance.signalingState}`);
        if (pcInstance.signalingState === 'stable') {
            isNegotiatingRef.current = false; // Reset negotiation flag when stable
            ignoreOffer.current = false;    // Reset ignoreOffer flag when stable
        }
    };
    
    if (localStreamRef.current && localStreamRef.current.active) {
      const stream = localStreamRef.current;
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
          if (!pcInstance.getSenders().find(s => s.track === audioTracks[0])) {
              pcInstance.addTrack(audioTracks[0], stream);
              console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added audio track explicitly.`);
          }
      } else {
          console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: No local audio tracks to add.`);
      }

      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
          if (!pcInstance.getSenders().find(s => s.track === videoTracks[0])) {
              pcInstance.addTrack(videoTracks[0], stream);
              console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added video track explicitly.`);
          }
      } else {
          console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: No local video tracks to add.`);
      }
    } else {
        console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Local stream not available or not active when creating PC. Tracks won't be added yet.`);
    }
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT, setupLocalStream]);


  const startCall = useCallback(async (isCallerFlag: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}. RoomID: ${roomId}, RemoteUID: ${remoteUserId}`);
    
    let stream = localStreamRef.current;
    if (!stream || !stream.active) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream not available or not active, calling setupLocalStream.`);
        stream = await setupLocalStream();
    }

    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting call start.`);
      onConnectionStateChange?.('failed_local_media');
      return;
    }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: No existing PC or PC is closed, creating a new one.`);
        pc = createPeerConnection(); 
        if (!pc) {
            console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`);
            return;
        }
    } else {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Existing PC found. State: ${pc.signalingState}`);
    }
    
    // Ensure tracks are added (or re-added if PC was just created)
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
        if (!pc.getSenders().find(s => s.track === audioTracks[0])) {
            pc.addTrack(audioTracks[0], stream);
            console.log(`[WebRTC ${CUID_SHORT}] startCall: Added audio track explicitly.`);
        }
    }
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
        if (!pc.getSenders().find(s => s.track === videoTracks[0])) {
            pc.addTrack(videoTracks[0], stream);
            console.log(`[WebRTC ${CUID_SHORT}] startCall: Added video track explicitly.`);
        }
    }
    console.log(`[WebRTC ${CUID_SHORT}] startCall: Senders after ensuring tracks:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
    
    // For the caller, if PC is stable, adding tracks should trigger onnegotiationneeded.
    // If `onnegotiationneeded` is not triggered automatically after adding tracks
    // and `isCallerFlag` is true and state is stable, a manual offer might be needed.
    // However, typically adding tracks to a stable connection that needs negotiation should trigger it.
    if (isCallerFlag && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC is stable. Expecting onnegotiationneeded to fire due to track additions or existing need.`);
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange, CUID_SHORT, roomId, remoteUserId]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping.`, { roomId, remoteUserId, currentUserId });
        return;
    }

    let pcInstance = peerConnectionRef.current;
    if (!pcInstance || pcInstance.signalingState === 'closed') { 
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: PC is null or closed for room ${roomId}. Creating new PC.`);
        pcInstance = createPeerConnection(); 
        if (!pcInstance) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Failed to create PeerConnection for room ${roomId}. Aborting listener setup.`);
          return;
        }
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, listening for signals from ${remoteUserId}. PC State: ${pcInstance.signalingState}`);
    
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const currentPC = peerConnectionRef.current; 
      if (!currentPC || currentPC.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal but PC is null or closed for room ${roomId}. Ignoring signal type: ${signal.type}`);
          return;
      }
      console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${currentPC.signalingState}, isNegotiatingRef: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}`);
      
      try {
        if (signal.type === 'offer') {
          // Glare Resolution: If this peer is already in the process of making an offer,
          // it should ignore the incoming offer from the other peer. Its own offer will proceed.
          if (makingOffer.current) {
            console.warn(`[WebRTC ${CUID_SHORT}] Glare: Received offer from ${remoteUserId} while I was already making one (makingOffer is true). Ignoring their offer. My offer will proceed.`);
            return; // This peer continues with its offer, the other peer must handle it.
          }

          // If not making an offer, then this peer is the callee.
          isNegotiatingRef.current = true;
          ignoreOffer.current = true; // Prevent its own onnegotiationneeded from firing.

          let streamForAnswer = localStreamRef.current;
          if (!streamForAnswer || !streamForAnswer.active) {
            console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready or inactive. Setting up...`);
            streamForAnswer = await setupLocalStream();
          }

          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Offer received, but local stream setup FAILED. Cannot create answer with media.`);
            isNegotiatingRef.current = false;
            ignoreOffer.current = false; 
            return;
          }
          
          // Ensure tracks from the local stream are on the peer connection
          const audioTracks = streamForAnswer.getAudioTracks();
          if (audioTracks.length > 0) {
              if (!currentPC.getSenders().find(s => s.track === audioTracks[0])) {
                  currentPC.addTrack(audioTracks[0], streamForAnswer);
                  console.log(`[WebRTC ${CUID_SHORT} Callee] Offer Handler: Added audio track explicitly before setRemoteDescription.`);
              }
          }
          const videoTracks = streamForAnswer.getVideoTracks();
          if (videoTracks.length > 0) {
              if (!currentPC.getSenders().find(s => s.track === videoTracks[0])) {
                  currentPC.addTrack(videoTracks[0], streamForAnswer);
                  console.log(`[WebRTC ${CUID_SHORT} Callee] Offer Handler: Added video track explicitly before setRemoteDescription.`);
              }
          }
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before setRemoteDescription(offer):`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));

          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT} Callee] Remote description (offer) set. Creating answer...`);
          
          const answer = await currentPC.createAnswer();
          console.log(`[WebRTC ${CUID_SHORT} Callee] Answer created. Current pc.signalingState: ${currentPC.signalingState}`);
          if (currentPC.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] Signaling state IS NOT have-remote-offer (${currentPC.signalingState}) before setLocalDescription(answer). Aborting answer.`);
             isNegotiatingRef.current = false;
             ignoreOffer.current = false;
             return;
          }
          await currentPC.setLocalDescription(answer);
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local description (answer) set. New state: ${currentPC.signalingState}`);


          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT} Callee] Answer sent.`);
          }
          isNegotiatingRef.current = false;
          // ignoreOffer.current should be reset by onsignalingstatechange when stable

        } else if (signal.type === 'answer') {
           if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${currentPC.signalingState}. Ignoring.`);
            return; 
          }
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${currentPC.signalingState}`);
          makingOffer.current = false; // Offer process complete
          isNegotiatingRef.current = false; 

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) { 
            try {
              await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
            } catch (e) {
              console.error(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e, "Candidate:", signal.candidate, "PC Signalling State:", currentPC.signalingState);
            }
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set on PC instance (state: ${currentPC?.signalingState}). Candidate might be queued by browser. Candidate:`, signal.candidate);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal type ${signal.type} in room ${roomId}:`, error);
        isNegotiatingRef.current = false; 
        makingOffer.current = false;
        ignoreOffer.current = false;
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}`);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream]);


  const cleanup = useCallback(async () => {
    const currentRoomIdForLog = roomIdRef.current; // Capture current roomId from ChatApp's ref for logging
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room: ${currentRoomIdForLog}`);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null; 
      onLocalStream(null); 
      console.log(`[WebRTC ${CUID_SHORT}] Local stream stopped and cleared.`);
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
      console.log(`[WebRTC ${CUID_SHORT}] PeerConnection closed and cleared.`);
    }
    onRemoteStream(null); 
    isNegotiatingRef.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    // onConnectionStateChange?.('closed'); // This can trigger the recursive call if not handled carefully
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished. onConnectionStateChange('closed') will be called by ChatApp if needed or by PC state.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT /* Removed onConnectionStateChange from deps to avoid re-creating cleanup too often */]);

  // Expose a stable ref to roomId from ChatApp if needed, though it's passed as prop
  const roomIdRef = useRef(roomId);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);


  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}


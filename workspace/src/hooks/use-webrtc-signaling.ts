
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
  const [isNegotiating, setIsNegotiating] = useState(false);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const CUID_SHORT = currentUserId?.substring(0,5) || 'unknown';


  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream already exists.`);
        onLocalStream(localStreamRef.current); 
        return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id}, Tracks:`, stream.getTracks().map(t => t.kind));
      
      // If PC exists, add tracks from this new stream
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists, ensuring tracks are added.`);
        const pc = peerConnectionRef.current;
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
    
    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection`);
    const pc = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnectionRef.current = pc; 

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        // console.log(`[WebRTC ${CUID_SHORT}] Sending ICE candidate:`, event.candidate.candidate.substring(0, 30) + "...");
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Number of streams: ${event.streams.length}. Track kind: ${event.track.kind}`);
      event.streams.forEach((stream, index) => {
        console.log(`[WebRTC ${CUID_SHORT}] Stream ${index}: ID=${stream.id}, Active=${stream.active}, Tracks:`, stream.getTracks().map(t => `${t.kind} (ID: ${t.id.substring(0,5)}, Label: ${t.label}, Enabled: ${t.enabled}, ReadyState: ${t.readyState})`));
        stream.onaddtrack = (e) => console.log(`[WebRTC ${CUID_SHORT}] Track added to remote stream ${stream.id}: ${e.track.kind}`);
        stream.onremovetrack = (e) => console.log(`[WebRTC ${CUID_SHORT}] Track removed from remote stream ${stream.id}: ${e.track.kind}`);
      });

      if (event.streams && event.streams[0]) {
        const remoteStream = event.streams[0];
        onRemoteStream(remoteStream);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK event received, but no streams[0]. Event:`, event);
        onRemoteStream(null);
      }
    };
    
    pc.onnegotiationneeded = async () => {
      if (makingOffer.current || pc.signalingState !== 'stable' || isNegotiating) {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING, already making offer, not stable, or isNegotiating. State: ${pc.signalingState}, makingOffer: ${makingOffer.current}, isNegotiating: ${isNegotiating}`);
        return;
      }
      try {
        makingOffer.current = true;
        setIsNegotiating(true);
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Negotiation needed, creating offer...`);
        
        if (localStreamRef.current) {
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Local tracks on PC before creating offer:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
        }

        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') { 
             console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state changed to ${pc.signalingState} before setLocalDescription for offer. Aborting.`);
             makingOffer.current = false;
             setIsNegotiating(false);
             return;
        }
        await pc.setLocalDescription(offer);
        // console.log(`[WebRTC ${CUID_SHORT}] Local description (offer) set. SDP:`, pc.localDescription?.sdp.substring(0,50) + "...");
        if (roomId && currentUserId && remoteUserId && pc.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
           console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent to remote user.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error during negotiation:`, err);
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
            // makingOffer.current = false; // Be careful resetting makingOffer here, only if truly stable and not expecting an answer.
            // setIsNegotiating(false); // Similarly, be cautious.
        }
    };
    
    if (localStreamRef.current) {
        const stream = localStreamRef.current;
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            if (!pc.getSenders().find(s => s.track === audioTracks[0])) {
                pc.addTrack(audioTracks[0], stream);
                console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added audio track.`);
            }
        }
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
            if (!pc.getSenders().find(s => s.track === videoTracks[0])) {
                pc.addTrack(videoTracks[0], stream);
                console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Added video track.`);
            }
        }
    } else {
        console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Local stream not available. Tracks won't be added yet.`);
    }
    return pc;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, toast, CUID_SHORT, isNegotiating, setupLocalStream]);


  const startCall = useCallback(async (isCaller: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCaller}`);
    
    // Ensure local stream is ready *before* proceeding with PC logic
    let stream = localStreamRef.current;
    if (!stream) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream not yet available, calling setupLocalStream.`);
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

    // Ensure tracks are added using the explicit audio-then-video order
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
        if (!pc.getSenders().find(s => s.track === audioTracks[0])) {
            pc.addTrack(audioTracks[0], stream);
            console.log(`[WebRTC ${CUID_SHORT}] startCall: Added audio track.`);
        }
    }
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length > 0) {
        if (!pc.getSenders().find(s => s.track === videoTracks[0])) {
            pc.addTrack(videoTracks[0], stream);
            console.log(`[WebRTC ${CUID_SHORT}] startCall: Added video track.`);
        }
    }
    console.log(`[WebRTC ${CUID_SHORT}] startCall: Senders after ensuring tracks:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
    
    // Offer creation logic moved primarily to onnegotiationneeded
    // but if isCaller and stable, and negotiation doesn't fire, we might need to kickstart it.
    if (isCaller && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiating) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC is stable, explicitly triggering negotiation for offer.`);
        // This will trigger pc.onnegotiationneeded if conditions within it are met
        // Or, we can directly create offer here if onnegotiationneeded is unreliable.
        // For now, rely on onnegotiationneeded being triggered by track additions or if it was pending.
        // If onnegotiationneeded is problematic, a direct offer creation path here might be needed.
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange, CUID_SHORT, isNegotiating, roomId, currentUserId, remoteUserId]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
        // console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Not all IDs present, skipping.`, {roomId, remoteUserId, currentUserId});
        return;
    }

    let pcInstance = peerConnectionRef.current;
    if (!pcInstance || pcInstance.signalingState === 'closed') { 
        console.log(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: PC is null or closed. Attempting to use existing or create.`);
        pcInstance = createPeerConnection(); // This will set peerConnectionRef.current
        if (!pcInstance) {
          console.error(`[WebRTC ${CUID_SHORT}] Signaling listener useEffect: Failed to create PeerConnection. Aborting listener setup.`);
          return;
        }
    }
    
    console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, listening for signals from ${remoteUserId}. PC State: ${pcInstance.signalingState}`);
    
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      // Use the current ref inside async callback, as pcInstance from closure might be stale if PC was recreated
      const currentPC = peerConnectionRef.current; 
      if (!currentPC || currentPC.signalingState === 'closed') {
          console.warn(`[WebRTC ${CUID_SHORT}] Received signal but PC is null or closed. Ignoring signal type: ${signal.type}`);
          return;
      }
      console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${currentPC.signalingState}, isNegotiating: ${isNegotiating}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}`);
      
      try {
        if (signal.type === 'offer') {
          if (makingOffer.current || currentPC.signalingState === 'have-local-offer' || ignoreOffer.current || isNegotiating) {
            console.warn(`[WebRTC ${CUID_SHORT}] Offer received but in conflicting state. My ID: ${currentUserId}, Remote: ${remoteUserId}. Glare/Conflict handling.`);
            if (currentUserId > remoteUserId && (makingOffer.current || currentPC.signalingState === 'have-local-offer')) {
                console.log(`[WebRTC ${CUID_SHORT}] Glare: Ignoring incoming offer as my ID is larger and I'm making/made an offer.`);
                return; 
            }
            // If not returning, this side will process the offer (e.g. lower ID)
            // It might need to rollback its own offer if one was in flight.
          }
          
          setIsNegotiating(true);
          
          let streamForAnswer = localStreamRef.current;
          if (!streamForAnswer) {
            console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready. Setting up...`);
            streamForAnswer = await setupLocalStream();
          }

          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Offer received, but local stream setup FAILED. Cannot create answer.`);
            setIsNegotiating(false);
            return;
          }
          
          // Ensure tracks from the now-guaranteed localStreamRef.current are on this PC instance
          const audioTracks = streamForAnswer.getAudioTracks();
          if (audioTracks.length > 0) {
              if (!currentPC.getSenders().find(s => s.track === audioTracks[0])) {
                  currentPC.addTrack(audioTracks[0], streamForAnswer);
                  console.log(`[WebRTC ${CUID_SHORT} Callee] Offer Handler: Added audio track.`);
              }
          }
          const videoTracks = streamForAnswer.getVideoTracks();
          if (videoTracks.length > 0) {
              if (!currentPC.getSenders().find(s => s.track === videoTracks[0])) {
                  currentPC.addTrack(videoTracks[0], streamForAnswer);
                  console.log(`[WebRTC ${CUID_SHORT} Callee] Offer Handler: Added video track.`);
              }
          }
          console.log(`[WebRTC ${CUID_SHORT} Callee] Offer Handler: Local tracks on PC before setRemote(offer):`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));

          // console.log(`[WebRTC ${CUID_SHORT}] Setting remote description (offer): SDP=${signal.sdp?.substring(0,50)}...`);
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          
          console.log(`[WebRTC ${CUID_SHORT}] Creating answer...`);
          const answer = await currentPC.createAnswer();
          // console.log(`[WebRTC ${CUID_SHORT}] Setting local description (answer): SDP=${answer.sdp?.substring(0,50)}...`);
          await currentPC.setLocalDescription(answer);

          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT}] Answer sent.`);
          }
          setIsNegotiating(false);
          makingOffer.current = false; // Reset as we've processed an offer and answered.
          ignoreOffer.current = false;

        } else if (signal.type === 'answer') {
           if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT}] Answer received but PC not in 'have-local-offer' state. Current state: ${currentPC.signalingState}. Ignoring.`);
            return; 
          }
          // console.log(`[WebRTC ${CUID_SHORT}] Setting remote description (answer): SDP=${signal.sdp?.substring(0,50)}...`);
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT}] Remote description (answer) set.`);
          makingOffer.current = false; // Offer-answer cycle complete for us.
          setIsNegotiating(false); // Negotiation should be stable now.

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) { 
            // console.log(`[WebRTC ${CUID_SHORT}] Adding ICE candidate:`, (signal.candidate as RTCIceCandidate).candidate?.substring(0,30) + "...");
             await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
             // console.log(`[WebRTC ${CUID_SHORT}] ICE candidate added.`);
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description not set yet. Candidate will be queued by browser or added.`);
             await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit)); // Try adding anyway
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal type ${signal.type}:`, error);
        setIsNegotiating(false); 
        makingOffer.current = false;
        ignoreOffer.current = false;
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room:`, roomId);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, isNegotiating, setupLocalStream]);


  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room`, roomId);
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
    setIsNegotiating(false);
    makingOffer.current = false;
    ignoreOffer.current = false;
    // Call onConnectionStateChange last to signify the end of the cleanup.
    // This helps prevent immediate re-triggering of cleanup if onConnectionStateChange itself calls cleanup.
    // The guard in ChatApp's onConnectionStateChange should handle recursion.
    onConnectionStateChange?.('closed'); 
  }, [roomId, onLocalStream, onRemoteStream, onConnectionStateChange, CUID_SHORT]);

  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}

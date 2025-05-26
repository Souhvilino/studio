
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
      stream.getTracks().forEach(track => {
        console.log(`[WebRTC ${CUID_SHORT}] Local Track Details: kind=${track.kind}, id=${track.id.substring(0,5)}, label=${track.label}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });
      
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
        const pc = peerConnectionRef.current;
        // console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are added/replaced.`);
        
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
            if (!pc.getSenders().find(s => s.track === audioTrack)) {
                pc.addTrack(audioTrack, stream);
                // console.log(`[WebRTC ${CUID_SHORT} setupLocalStream] Added audio track to existing PC.`);
            }
        }
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            if (!pc.getSenders().find(s => s.track === videoTrack)) {
                pc.addTrack(videoTrack, stream);
                // console.log(`[WebRTC ${CUID_SHORT} setupLocalStream] Added video track to existing PC.`);
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
      // console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs`);
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
      event.streams.forEach((stream, index) => {
        // console.log(`[WebRTC ${CUID_SHORT}] Remote Stream ${index} (ID: ${stream.id}): Active=${stream.active}`);
        stream.getTracks().forEach(t => {
          console.log(`  [WebRTC ${CUID_SHORT}] Remote Track received: Kind=${t.kind}, ID=${t.id.substring(0,5)}, Label=${t.label}, Enabled=${t.enabled}, Muted=${t.muted}, ReadyState=${t.readyState}`);
          t.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${t.kind} track MUTED: ${t.id.substring(0,5)}`);
          t.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${t.kind} track UNMUTED: ${t.id.substring(0,5)}`);
        });
      });

      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      } else {
        const newStream = new MediaStream();
        newStream.addTrack(event.track);
        // console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] undefined. Created new stream with track: Kind=${event.track.kind}, ID=${event.track.id.substring(0,5)}`);
        onRemoteStream(newStream);
      }
    };
    
    pcInstance.onnegotiationneeded = async () => {
      if (makingOffer.current || pcInstance.signalingState !== 'stable' || isNegotiatingRef.current || ignoreOffer.current) {
        // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING, condition not met.`);
        return;
      }
      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true; 
        // console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer...`);
        
        const offer = await pcInstance.createOffer();
        // console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local)]:`, offer.sdp?.substring(0,100) + "...");
        
        if (pcInstance.signalingState !== 'stable') { 
             makingOffer.current = false; isNegotiatingRef.current = false; return;
        }
        await pcInstance.setLocalDescription(offer);

        if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
           FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pcInstance.localDescription.sdp });
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error:`, err);
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
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && !pcInstance.getSenders().find(s => s.track === videoTrack)) {
          pcInstance.addTrack(videoTrack, stream);
      }
    }
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT, setupLocalStream]);


  const startCall = useCallback(async (isCallerFlag: boolean) => {
    // console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}`);
    
    let stream = localStreamRef.current;
    if (!stream?.active) {
        stream = await setupLocalStream();
    }
    if (!stream) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream.`); return; }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
        pc = createPeerConnection(); 
        if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack && !pc.getSenders().find(s => s.track === audioTrack)) { pc.addTrack(audioTrack, stream); }
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && !pc.getSenders().find(s => s.track === videoTrack)) { pc.addTrack(videoTrack, stream); }
    // console.log(`[WebRTC ${CUID_SHORT}] PC Senders after startCall track ensure: `, pc.getSenders().map(s => `${s.track?.kind}:${s.track?.id.substring(0,5)}`));

  }, [setupLocalStream, createPeerConnection, CUID_SHORT]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) { return; }

    let pcInstance = peerConnectionRef.current;
    if (!pcInstance || pcInstance.signalingState === 'closed') { 
        pcInstance = createPeerConnection(); 
        if (!pcInstance) { console.error(`[WebRTC ${CUID_SHORT}] Signaling listener: Failed to create PC.`); return; }
    }
    
    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const currentPC = peerConnectionRef.current; 
      if (!currentPC || currentPC.signalingState === 'closed') { return; }
      // console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC state: ${currentPC.signalingState}`);
      
      try {
        if (signal.type === 'offer') {
          // console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, signal.sdp?.substring(0,100) + "...");
          if (makingOffer.current || currentPC.signalingState !== 'stable') {
            console.warn(`[WebRTC ${CUID_SHORT}] Glare or unstable state (${currentPC.signalingState}), ignoring incoming offer.`);
            return; 
          }

          isNegotiatingRef.current = true;
          ignoreOffer.current = true; 

          let streamToUseForAnswer = localStreamRef.current;
          if (!streamToUseForAnswer?.active) {
            // console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready. Setting up...`);
            streamToUseForAnswer = await setupLocalStream();
          }
          if (!streamToUseForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Local stream FAILED for answer.`);
            isNegotiatingRef.current = false; ignoreOffer.current = false; 
            return;
          }
          
          const audioTrack = streamToUseForAnswer.getAudioTracks()[0];
          if (audioTrack && !currentPC.getSenders().find(s => s.track === audioTrack)) {
              currentPC.addTrack(audioTrack, streamToUseForAnswer);
          }
          const videoTrack = streamToUseForAnswer.getVideoTracks()[0];
          if (videoTrack && !currentPC.getSenders().find(s => s.track === videoTrack)) {
              currentPC.addTrack(videoTrack, streamToUseForAnswer);
          }
          // console.log(`[WebRTC ${CUID_SHORT} Callee] PC Senders before setRemote(offer): `, currentPC.getSenders().map(s => `${s.track?.kind}:${s.track?.id.substring(0,5)}`));

          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          const answer = await currentPC.createAnswer();
          // console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local)]:`, answer.sdp?.substring(0,100) + "...");
          
          if (currentPC.signalingState !== 'have-remote-offer') {
             isNegotiatingRef.current = false; ignoreOffer.current = false; return;
          }
          await currentPC.setLocalDescription(answer);

          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
          }
          isNegotiatingRef.current = false; 

        } else if (signal.type === 'answer') {
          // console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, signal.sdp?.substring(0,100) + "...");
           if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer'. State: ${currentPC.signalingState}. Ignoring.`);
            return; 
          }
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          makingOffer.current = false; 
          isNegotiatingRef.current = false; 

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) { 
            try { await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit)); } 
            catch (e) { /* console.error(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e); */ }
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
        isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false;
      }
    });

    return () => { unsubscribe(); };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream]);


  const cleanup = useCallback(async () => {
    // console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room: ${roomIdRef.current}`);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null; 
      onLocalStream(null); 
    }
    if (peerConnectionRef.current) {
      const pc = peerConnectionRef.current;
      pc.ontrack = null; pc.onicecandidate = null; pc.oniceconnectionstatechange = null;
      pc.onsignalingstatechange = null; pc.onnegotiationneeded = null;
      if (pc.signalingState !== 'closed') { pc.close(); }
      peerConnectionRef.current = null; 
    }
    onRemoteStream(null); 
    isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false;
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  const localRoomIdRef = useRef(roomId); 
  useEffect(() => {
    localRoomIdRef.current = roomId;
  }, [roomId]);


  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}


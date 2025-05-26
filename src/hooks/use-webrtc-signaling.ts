
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
  const isNegotiatingRef = useRef(false); // Prevents multiple negotiations at once
  const politePeer = useRef(false); // For glare resolution based on who is the caller
  const transceiversAddedRef = useRef(false); // To track if initial transceivers have been added

  const CUID_SHORT = currentUserId?.substring(0,5) || 'anon';

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream already exists and is active.`);
      onLocalStream(localStreamRef.current);
      return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Local stream acquired: ID=${stream.id}, Tracks:`, stream.getTracks().map(t => `${t.kind}:${t.id.substring(0,5)}`));
      stream.getTracks().forEach(track => {
        console.log(`[WebRTC ${CUID_SHORT}] Local Track Details: kind=${track.kind}, id=${track.id.substring(0,5)}, label=${track.label.substring(0,10)}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });

      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') {
        console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: PC exists (state: ${pc.signalingState}), ensuring tracks are updated/added.`);
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
          if (audioSender) {
            console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Replacing audio track.`);
            await audioSender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing audio track:`, e));
          } else if (!pc.getSenders().find(s => s.track === audioTrack)) { // Should ideally not happen if transceivers were added
            pc.addTrack(audioTrack, stream);
            console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added new audio track to existing PC.`);
          }
        }
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender) {
            console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Replacing video track.`);
            await videoSender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing video track:`, e));
          } else if (!pc.getSenders().find(s => s.track === videoTrack)) {
            pc.addTrack(videoTrack, stream);
            console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Added new video track to existing PC.`);
          }
        }
        console.log(`[WebRTC ${CUID_SHORT}] PC Senders after setupLocalStream and PC existed: `, pc.getSenders().map(s => `${s.track?.kind}:${s.track?.id.substring(0,5)}`));
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
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs.`);
      return null;
    }

    if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') {
      console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Reusing existing PC in state: ${peerConnectionRef.current.signalingState}`);
    } else {
      console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}`);
      peerConnectionRef.current = new RTCPeerConnection(RTC_CONFIGURATION);
      transceiversAddedRef.current = false; // Reset when new PC is made
    }

    const pcInstance = peerConnectionRef.current;

    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };

    pcInstance.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK event received. Number of streams: ${event.streams.length}. Track kind: ${event.track.kind}, ID: ${event.track.id.substring(0,5)}, muted: ${event.track.muted}, enabled: ${event.track.enabled}, readyState: ${event.track.readyState}`);
      event.track.onmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track MUTED: ${event.track.id.substring(0,5)}`);
      event.track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track UNMUTED: ${event.track.id.substring(0,5)}`);

      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      } else {
        console.warn(`[WebRTC ${CUID_SHORT}] ONTRACK: event.streams[0] undefined. Creating new stream with track: Kind=${event.track.kind}, ID=${event.track.id.substring(0,5)}`);
        const newStream = new MediaStream();
        newStream.addTrack(event.track);
        onRemoteStream(newStream);
      }
    };

    pcInstance.onnegotiationneeded = async () => {
      if (isNegotiatingRef.current || makingOffer.current || pcInstance.signalingState !== 'stable') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING, condition not met. State: ${pcInstance.signalingState}, makingOffer: ${makingOffer.current}, isNegotiatingRef: ${isNegotiatingRef.current}, ignoreOffer: ${ignoreOffer.current}`);
        return;
      }
      try {
        makingOffer.current = true;
        isNegotiatingRef.current = true;
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite peer: ${politePeer.current}`);

        const offer = await pcInstance.createOffer();
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local)]:`, offer.sdp?.substring(0, 150) + "...");

        if (pcInstance.signalingState !== 'stable') {
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Signaling state changed to ${pcInstance.signalingState} before setLocalDescription(offer). Aborting offer.`);
          makingOffer.current = false;
          isNegotiatingRef.current = false;
          return;
        }
        await pcInstance.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: pc.setLocalDescription(offer) SUCCEEDED. New state: ${pcInstance.signalingState}`);

        if (roomId && currentUserId && remoteUserId && pcInstance.localDescription) {
          FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pcInstance.localDescription.sdp });
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Offer sent.`);
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Error during negotiation:`, err);
      } finally {
        makingOffer.current = false; // Reset makingOffer here, as it's set at the start of this try block
        // isNegotiatingRef will be reset when signalingState becomes 'stable' or if an error occurs in signal handling.
      }
    };

    pcInstance.oniceconnectionstatechange = () => {
      console.log(`[WebRTC ${CUID_SHORT}] ICE connection state: ${pcInstance.iceConnectionState}`);
      onConnectionStateChange?.(pcInstance.iceConnectionState);
    };

    pcInstance.onsignalingstatechange = () => {
      console.log(`[WebRTC ${CUID_SHORT}] Signaling state changed to: ${pcInstance.signalingState}`);
      if (pcInstance.signalingState === 'stable') {
        isNegotiatingRef.current = false;
        ignoreOffer.current = false; // Safe to accept offers now
      }
    };

    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT]);


  const startCall = useCallback(async (isCallerFlag: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall invoked. Is Caller: ${isCallerFlag}. RoomID: ${roomId}, RemoteUID: ${remoteUserId}`);
    politePeer.current = !isCallerFlag; // Callee is polite

    let stream = localStreamRef.current;
    if (!stream?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Local stream not/inactive, calling setupLocalStream.`);
      stream = await setupLocalStream();
    }
    if (!stream) {
      console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream. Aborting.`);
      onConnectionStateChange?.('failed_local_media');
      return;
    }

    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: No/Closed PC, creating new one.`);
      pc = createPeerConnection();
      if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create peer connection.`); return; }
    }

    if (!transceiversAddedRef.current) {
      console.log(`[WebRTC ${CUID_SHORT}] startCall: Adding initial transceivers (audio/video sendrecv).`);
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      transceiversAddedRef.current = true;
    }
    
    // Replace tracks on existing senders
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    pc.getSenders().forEach(sender => {
      if (sender.track?.kind === 'audio' && audioTrack && sender.track !== audioTrack) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Replacing audio track on sender.`);
        sender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing audio track in startCall:`, e));
      }
      if (sender.track?.kind === 'video' && videoTrack && sender.track !== videoTrack) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall: Replacing video track on sender.`);
        sender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing video track in startCall:`, e));
      }
    });
    
    console.log(`[WebRTC ${CUID_SHORT}] startCall: Senders after ensuring tracks:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));

    // If this peer is the caller, onnegotiationneeded should fire to create the offer
    // If it's the callee, it will wait for an offer.
    if (isCallerFlag && pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
      console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): PC is stable. Manually triggering onnegotiationneeded check or offer creation if transceivers were just added.`);
      // Forcibly trigger negotiation if transceivers were just added, as onnegotiationneeded might not fire automatically
       if (makingOffer.current || pc.signalingState !== 'stable' || isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): SKIPPING offer, negotiation already in progress or state not stable.`);
      } else {
        try {
          makingOffer.current = true;
          isNegotiatingRef.current = true;
          console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Creating offer directly...`);
          const offer = await pc.createOffer();
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) in startCall]:`, offer.sdp?.substring(0,150)+"...");
          if (pc.signalingState !== 'stable') {
             makingOffer.current = false; isNegotiatingRef.current = false; return;
          }
          await pc.setLocalDescription(offer);
          if (roomId && currentUserId && remoteUserId && pc.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: pc.localDescription.sdp });
          }
        } catch (err) {
          console.error(`[WebRTC ${CUID_SHORT}] Error creating offer in startCall:`, err);
        } finally {
          makingOffer.current = false;
          // isNegotiatingRef will be reset by signalingState change
        }
      }
    }

  }, [setupLocalStream, createPeerConnection, onConnectionStateChange, CUID_SHORT, roomId, remoteUserId, currentUserId]);


  useEffect(() => {
    if (!roomId || !remoteUserId || !currentUserId) {
      return;
    }

    let pcInstance = peerConnectionRef.current;
    if (!pcInstance || pcInstance.signalingState === 'closed') {
      pcInstance = createPeerConnection();
      if (!pcInstance) {
        console.error(`[WebRTC ${CUID_SHORT}] Signaling listener: Failed to create PC for room ${roomId}.`);
        return;
      }
    }
    console.log(`[WebRTC ${CUID_SHORT}] Setting up signal listener for room ${roomId}, for signals from ${remoteUserId}. PC State: ${pcInstance.signalingState}`);

    const unsubscribe = FirestoreService.listenForSignals(roomId, currentUserId, async (signal) => {
      const currentPC = peerConnectionRef.current;
      if (!currentPC || currentPC.signalingState === 'closed') {
        console.warn(`[WebRTC ${CUID_SHORT}] Received signal but PC is null/closed for room ${roomId}. Ignoring: ${signal.type}`);
        return;
      }
      console.log(`[WebRTC ${CUID_SHORT}] Received signal: Type=${signal.type}, PC signaling state: ${currentPC.signalingState}, isNegotiatingRef: ${isNegotiatingRef.current}, makingOffer: ${makingOffer.current}, ignoreOffer: ${ignoreOffer.current}, politePeer: ${politePeer.current}`);

      try {
        if (signal.type === 'offer') {
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]:`, signal.sdp?.substring(0,150)+"...");
          
          const offerCollision = makingOffer.current || currentPC.signalingState !== "stable";
          if (offerCollision) {
            ignoreOffer.current = politePeer.current; // Polite peer ignores offer if collision
            if (ignoreOffer.current) {
              console.warn(`[WebRTC ${CUID_SHORT} Polite Peer] Glare: Received offer while making one or not stable. Ignoring incoming offer.`);
              return;
            }
             console.warn(`[WebRTC ${CUID_SHORT} Impolite Peer] Glare: Received offer while making one or not stable. Proceeding with incoming offer (will send answer).`);
          }
          
          isNegotiatingRef.current = true; // Start negotiation
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT} Callee] Remote description (offer) set. Current pc.signalingState: ${currentPC.signalingState}`);

          let streamForAnswer = localStreamRef.current;
          if (!streamForAnswer?.active) {
            console.log(`[WebRTC ${CUID_SHORT} Callee] Offer received, local stream not ready or inactive. Setting up...`);
            streamForAnswer = await setupLocalStream();
          }

          if (!streamForAnswer) {
            console.error(`[WebRTC ${CUID_SHORT} Callee] Offer received, but local stream setup FAILED. Cannot create answer.`);
            isNegotiatingRef.current = false; ignoreOffer.current = false;
            return;
          }
          
          // Ensure tracks are added before creating answer if they weren't already
          const audioTrack = streamForAnswer.getAudioTracks()[0];
          if (audioTrack && !currentPC.getSenders().find(s => s.track === audioTrack)) {
            currentPC.addTrack(audioTrack, streamForAnswer);
             console.log(`[WebRTC ${CUID_SHORT} Callee] Added audio track before creating answer.`);
          }
          const videoTrack = streamForAnswer.getVideoTracks()[0];
          if (videoTrack && !currentPC.getSenders().find(s => s.track === videoTrack)) {
             currentPC.addTrack(videoTrack, streamForAnswer);
             console.log(`[WebRTC ${CUID_SHORT} Callee] Added video track before creating answer.`);
          }
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local tracks on PC before creating answer:`, currentPC.getSenders().map(s => `${s.track?.kind}(${s.track?.id.substring(0,5)})`));
          
          const answer = await currentPC.createAnswer();
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local)]:`, answer.sdp?.substring(0,150)+"...");
          
          if (currentPC.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] Signaling state is ${currentPC.signalingState}, not 'have-remote-offer' before setLocalDescription(answer). Aborting answer.`);
             isNegotiatingRef.current = false; ignoreOffer.current = false;
             return;
          }
          await currentPC.setLocalDescription(answer);
          console.log(`[WebRTC ${CUID_SHORT} Callee] Local description (answer) set. New state: ${currentPC.signalingState}`);

          if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
            FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
            console.log(`[WebRTC ${CUID_SHORT} Callee] Answer sent.`);
          }
          // isNegotiatingRef will be reset when signalingState becomes 'stable'

        } else if (signal.type === 'answer') {
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]:`, signal.sdp?.substring(0,150)+"...");
          if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but PC not in 'have-local-offer' state. Current state: ${currentPC.signalingState}. Ignoring.`);
            return;
          }
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          console.log(`[WebRTC ${CUID_SHORT} Caller] Remote description (answer) set. New state: ${currentPC.signalingState}`);
          // isNegotiatingRef will be reset when signalingState becomes 'stable'

        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) {
            try {
              await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
            } catch (e) {
              console.warn(`[WebRTC ${CUID_SHORT}] Error adding ICE candidate:`, e, "Candidate:", signal.candidate);
            }
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but remote description is not yet set on PC instance (state: ${currentPC.signalingState}). Candidate might be queued by browser. Candidate:`, signal.candidate);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal type ${signal.type} in room ${roomId}:`, error, "Signal:", signal);
        isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false;
      }
    });

    return () => {
      console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room: ${roomId}`);
      unsubscribe();
    };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream]);


  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called.`);
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
      transceiversAddedRef.current = false; // Reset on cleanup
      console.log(`[WebRTC ${CUID_SHORT}] PeerConnection closed and cleared.`);
    }
    onRemoteStream(null);
    isNegotiatingRef.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    politePeer.current = false;
    // Not calling onConnectionStateChange('closed') here to avoid loops
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  return { startCall, cleanup, setupLocalStream, peerConnection: peerConnectionRef };
}

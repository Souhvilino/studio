
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
  const politePeer = useRef(false);

  const CUID_SHORT = currentUserId?.substring(0, 5) || 'anon';

  // This function associates tracks from a given stream with the PC's existing senders
  const associateTracksWithSenders = useCallback(async (pc: RTCPeerConnection, stream: MediaStream) => {
    console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Associating tracks from stream ${stream.id.substring(0,5)}`);
    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track?.kind === 'audio' || s.kind === 'audio'); // s.kind for unset transceiver
    const videoSender = senders.find(s => s.track?.kind === 'video' || s.kind === 'video');

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack && audioSender) {
      if (audioSender.track !== audioTrack) {
        console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing audio track.`);
        await audioSender.replaceTrack(audioTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing audio track:`, e));
      }
    } else if (audioTrack && !audioSender) {
      console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Audio track present in stream, but no audio sender found on PC. This is unexpected if transceivers were added.`);
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && videoSender) {
      if (videoSender.track !== videoTrack) {
        console.log(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Replacing video track.`);
        await videoSender.replaceTrack(videoTrack).catch(e => console.error(`[WebRTC ${CUID_SHORT}] Error replacing video track:`, e));
      }
    } else if (videoTrack && !videoSender) {
      console.warn(`[WebRTC ${CUID_SHORT}] associateTracksWithSenders: Video track present in stream, but no video sender found on PC. This is unexpected if transceivers were added.`);
    }
    console.log(`[WebRTC ${CUID_SHORT}] PC Senders after associateTracksWithSenders:`, pc.getSenders().map(s => `${s.track?.kind}(${s.track?.id?.substring(0,5)})`));
  }, [CUID_SHORT]);


  const createPeerConnection = useCallback(() => {
    if (!roomId || !currentUserId || !remoteUserId) {
      console.warn(`[WebRTC ${CUID_SHORT}] createPeerConnection: Cannot create, missing IDs.`);
      return null;
    }
    console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Creating new PeerConnection for room ${roomId}.`);
    const pcInstance = new RTCPeerConnection(RTC_CONFIGURATION);
    peerConnectionRef.current = pcInstance;

    // Add initial transceivers. These establish the m-line "slots".
    // Tracks will be added to these senders later via replaceTrack by associateTracksWithSenders.
    if (pcInstance.getSenders().filter(s => s.track || s.receiver).length < 2) {
        pcInstance.addTransceiver('audio', { direction: 'sendrecv' });
        pcInstance.addTransceiver('video', { direction: 'sendrecv' });
        console.log(`[WebRTC ${CUID_SHORT}] createPeerConnection: Initial audio/video transceivers added.`);
    }

    pcInstance.onicecandidate = (event) => {
      if (event.candidate && roomId && currentUserId && remoteUserId) {
        console.log(`[WebRTC ${CUID_SHORT}] ICE candidate: type=${event.candidate.type}, address=${event.candidate.address}, protocol=${event.candidate.protocol}`);
        FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };
    pcInstance.onicecandidateerror = (event) => console.error(`[WebRTC ${CUID_SHORT}] ICE candidate error:`, event);
    pcInstance.onicegatheringstatechange = () => peerConnectionRef.current && console.log(`[WebRTC ${CUID_SHORT}] ICE gathering state: ${peerConnectionRef.current.iceGatheringState}`);
    pcInstance.ontrack = (event) => {
      console.log(`[WebRTC ${CUID_SHORT}] ONTRACK: kind=${event.track.kind}, muted=${event.track.muted}, enabled=${event.track.enabled}`);
      event.track.onunmute = () => console.log(`[WebRTC ${CUID_SHORT}] Remote ${event.track.kind} track UNMUTED.`);
      if (event.streams && event.streams[0]) onRemoteStream(event.streams[0]);
    };
    pcInstance.oniceconnectionstatechange = () => peerConnectionRef.current && onConnectionStateChange?.(peerConnectionRef.current.iceConnectionState);
    pcInstance.onsignalingstatechange = () => {
      if (peerConnectionRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] Signaling state: ${peerConnectionRef.current.signalingState}`);
        if (peerConnectionRef.current.signalingState === 'stable') {
          isNegotiatingRef.current = false; ignoreOffer.current = false; makingOffer.current = false;
        }
      }
    };
     pcInstance.onnegotiationneeded = async () => {
      const currentPC = peerConnectionRef.current;
      if (!currentPC || isNegotiatingRef.current || makingOffer.current || currentPC.signalingState !== 'stable') {
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: SKIPPING. Conditions: isNegotiatingRef=${isNegotiatingRef.current}, makingOffer=${makingOffer.current}, signalingState=${currentPC?.signalingState}`);
        return;
      }
      if (politePeer.current && currentPC.remoteDescription && currentPC.remoteDescription.type === 'offer') {
          console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Polite peer has remote offer. SKIPPING new offer.`);
          return;
      }
      try {
        makingOffer.current = true; isNegotiatingRef.current = true;
        console.log(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: Creating offer... Polite: ${politePeer.current}`);
        const offer = await currentPC.createOffer();
        if (currentPC.signalingState !== 'stable') {
          console.warn(`[WebRTC ${CUID_SHORT}] onnegotiationneeded: State changed before setLocalDescription. Aborting offer.`);
          makingOffer.current = false; isNegotiatingRef.current = false; return;
        }
        await currentPC.setLocalDescription(offer);
        console.log(`[WebRTC ${CUID_SHORT} OFFER SDP CREATED (local) by onnegotiationneeded]`);
        if (roomId && currentUserId && remoteUserId && currentPC.localDescription) {
          FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'offer', sdp: currentPC.localDescription.sdp });
        }
      } catch (err) {
        console.error(`[WebRTC ${CUID_SHORT}] onnegotiationneeded Error:`, err);
        isNegotiatingRef.current = false;
      } finally {
        makingOffer.current = false;
      }
    };
    return pcInstance;
  }, [roomId, currentUserId, remoteUserId, onRemoteStream, onConnectionStateChange, CUID_SHORT]);

  const setupLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current?.active) {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Re-using active local stream.`);
      onLocalStream(localStreamRef.current);
      const pc = peerConnectionRef.current;
      if (pc && pc.signallingState !== 'closed') await associateTracksWithSenders(pc, localStreamRef.current);
      return localStreamRef.current;
    }
    try {
      console.log(`[WebRTC ${CUID_SHORT}] setupLocalStream: Attempting to get user media...`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      onLocalStream(stream);
      stream.getTracks().forEach(track => console.log(`[WebRTC ${CUID_SHORT}] Local Track: ${track.kind}, enabled=${track.enabled}, muted=${track.muted}`));
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== 'closed') await associateTracksWithSenders(pc, stream);
      return stream;
    } catch (error) {
      console.error(`[WebRTC ${CUID_SHORT}] setupLocalStream Error:`, error);
      toast({ title: "Media Error", description: "Could not access camera/microphone.", variant: "destructive" });
      onLocalStream(null); return null;
    }
  }, [onLocalStream, toast, CUID_SHORT, associateTracksWithSenders]);

  const startCall = useCallback(async (isCallerFlag: boolean) => {
    console.log(`[WebRTC ${CUID_SHORT}] startCall. Is Caller: ${isCallerFlag}.`);
    politePeer.current = !isCallerFlag;
    let pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") {
      pc = createPeerConnection();
      if (!pc) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to create PC.`); return; }
    }
    const stream = await setupLocalStream();
    if (!stream) { console.error(`[WebRTC ${CUID_SHORT}] startCall: Failed to setup local stream.`); return; }
    if (isCallerFlag) {
      if (pc.signalingState === 'stable' && !makingOffer.current && !isNegotiatingRef.current) {
        console.log(`[WebRTC ${CUID_SHORT}] startCall (Caller): Triggering negotiation.`);
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
        console.log(`[WebRTC ${CUID_SHORT}] Received offer, PC is null. Creating PC (Callee).`);
        currentPC = createPeerConnection();
        if (!currentPC) { console.error(`[WebRTC ${CUID_SHORT}] Failed to create PC for offer.`); return; }
        politePeer.current = true;
      } else if (!currentPC || currentPC.signalingState === 'closed') {
        console.warn(`[WebRTC ${CUID_SHORT}] Received signal ${signal.type} but PC is null/closed. Ignoring.`); return;
      }
      console.log(`[WebRTC ${CUID_SHORT}] Received signal: ${signal.type}, PC state: ${currentPC.signalingState}, isNegotiating: ${isNegotiatingRef.current}`);
      try {
        if (signal.type === 'offer') {
          const offerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} OFFER SDP RECEIVED (remote)]`);
          if (makingOffer.current || (currentPC.signalingState !== "stable" && !politePeer.current )) { // Simplified glare
            console.warn(`[WebRTC ${CUID_SHORT}] Glare or unstable state. Ignoring incoming offer. makingOffer: ${makingOffer.current}, state: ${currentPC.signalingState}, polite: ${politePeer.current}`);
            return; 
          }
          isNegotiatingRef.current = true;
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Callee] Remote offer set. State: ${currentPC.signalingState}`);
          const streamForAnswer = await setupLocalStream();
          if (!streamForAnswer) { console.error(`[WebRTC ${CUID_SHORT} Callee] Local stream failed for answer.`); isNegotiatingRef.current = false; return; }
          const answer = await currentPC.createAnswer();
          if (currentPC.signalingState !== 'have-remote-offer') {
             console.warn(`[WebRTC ${CUID_SHORT} Callee] State changed before setLocalDescription(answer). Aborting.`); isNegotiatingRef.current = false; return;
          }
          await currentPC.setLocalDescription(answer);
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP CREATED (local) by Callee]`);
          if (currentPC.localDescription) FirestoreService.sendSignal(roomId, currentUserId, remoteUserId, { type: 'answer', sdp: currentPC.localDescription.sdp });
        } else if (signal.type === 'answer') {
          const answerSdp = signal.sdp!;
          console.log(`[WebRTC ${CUID_SHORT} ANSWER SDP RECEIVED (remote)]`);
          if (currentPC.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC ${CUID_SHORT} Caller] Answer received but state is ${currentPC.signalingState}. Ignoring.`); return;
          }
          isNegotiatingRef.current = true;
          await currentPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
          console.log(`[WebRTC ${CUID_SHORT} Caller] Remote answer set. State: ${currentPC.signalingState}`);
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (currentPC.remoteDescription) {
            await currentPC.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
          } else {
            console.warn(`[WebRTC ${CUID_SHORT}] Received ICE candidate but no remote description. Might be queued.`);
          }
        }
      } catch (error) {
        console.error(`[WebRTC ${CUID_SHORT}] Error handling signal ${signal.type}:`, error);
        isNegotiatingRef.current = false;
      }
    });
    return () => { console.log(`[WebRTC ${CUID_SHORT}] Cleaning up signal listener for room ${roomId}.`); unsubscribe(); };
  }, [roomId, remoteUserId, currentUserId, createPeerConnection, CUID_SHORT, setupLocalStream, associateTracksWithSenders]);

  const cleanup = useCallback(async () => {
    console.log(`[WebRTC ${CUID_SHORT}] cleanup called for room: ${roomIdRef.current}`);
    const currentPC = peerConnectionRef.current;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      onLocalStream(null);
    }
    if (currentPC) {
      currentPC.ontrack = null; pcInstance.onicecandidate = null; // Detach all
      currentPC.oniceconnectionstatechange = null; pcInstance.onsignalingstatechange = null;
      currentPC.onnegotiationneeded = null; pcInstance.onicecandidateerror = null;
      currentPC.onicegatheringstatechange = null;
      if (currentPC.signalingState !== 'closed') currentPC.close();
      peerConnectionRef.current = null;
    }
    onRemoteStream(null);
    isNegotiatingRef.current = false; makingOffer.current = false; ignoreOffer.current = false; politePeer.current = false;
    console.log(`[WebRTC ${CUID_SHORT}] cleanup finished.`);
  }, [onLocalStream, onRemoteStream, CUID_SHORT]);

  const roomIdRef = useRef(roomId);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  return { startCall, cleanup, setupLocalStream };
}

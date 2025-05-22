
"use client";

import React, { useEffect, useRef } from 'react';
import { User, VideoOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoAreaProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isChatting: boolean;
}

export function VideoArea({ localStream, remoteStream, isChatting }: VideoAreaProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log("[VideoArea Local] Setting local stream on video element. ID:", localStream?.id, "Tracks:", localStream?.getTracks().map(t => `${t.kind}:${t.label.substring(0,10)}(${t.id.substring(0,5)}) ${t.readyState} muted:${t.muted} enabled:${t.enabled}`));
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(error => console.warn("[VideoArea Local] Autoplay prevented:", error));
    } else {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log("[VideoArea Remote] Setting remote stream on video element. ID:", remoteStream.id);
      const videoTracks = remoteStream.getVideoTracks();
      const audioTracks = remoteStream.getAudioTracks();
      console.log(`[VideoArea Remote] Stream has ${videoTracks.length} video tracks and ${audioTracks.length} audio tracks.`);

      if (videoTracks.length > 0) {
        videoTracks.forEach(track => {
          console.log(`[VideoArea Remote Video Track Details] ID: ${track.id.substring(0,5)}, Kind: ${track.kind}, Label: ${track.label.substring(0,10)}, Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`);
          if (!track.enabled) console.warn(`[VideoArea Remote] CRITICAL: Video track ${track.id.substring(0,5)} is NOT ENABLED.`);
          if (track.readyState !== 'live') console.warn(`[VideoArea Remote] CRITICAL: Video track ${track.id.substring(0,5)} readyState is ${track.readyState}, not 'live'.`);
        });
      } else {
        console.warn("[VideoArea Remote] CRITICAL: Remote stream has NO video tracks.");
      }
       if (audioTracks.length > 0) {
        audioTracks.forEach(track => {
          console.log(`[VideoArea Remote Audio Track Details] ID: ${track.id.substring(0,5)}, Kind: ${track.kind}, Label: ${track.label.substring(0,10)}, Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`);
           if (!track.enabled) console.warn(`[VideoArea Remote] CRITICAL: Audio track ${track.id.substring(0,5)} is NOT ENABLED.`);
           if (track.muted) console.warn(`[VideoArea Remote] NOTE: Audio track ${track.id.substring(0,5)} IS MUTED.`); // This might be expected initially for autoplay
        });
      } else {
        console.warn("[VideoArea Remote] CRITICAL: Remote stream has NO audio tracks.");
      }

      remoteVideoRef.current.srcObject = remoteStream;
      // Attempt to play. Autoplay policies might prevent unmuted audio initially.
      remoteVideoRef.current.play().catch(error => console.warn("[VideoArea Remote] Autoplay prevented for remote stream:", error));
    } else {
      console.log("[VideoArea Remote] Remote stream is null or video ref is not current, clearing srcObject.");
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    }
  }, [remoteStream]);

  const videoPlaceholder = (text: string, iconType: 'videoOff' | 'user' = 'videoOff') => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      {iconType === 'videoOff' ? <VideoOff size={48} className="mb-2" /> : <User size={48} className="mb-2" />}
      <p className="text-sm">{text}</p>
    </div>
  );

  return (
    <div className="relative w-full aspect-video md:grid md:grid-cols-2 md:gap-4 md:aspect-auto">
      {/* Remote Video (Partner's Video) */}
      <div className="w-full h-full bg-black overflow-hidden md:rounded-lg md:shadow-lg md:aspect-video">
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay // autoPlay is important
          className="h-full w-full object-cover"
          onLoadedMetadata={(e) => {
            const video = e.target as HTMLVideoElement;
            console.log(`[VideoArea Remote] onloadedmetadata. Video dimensions: ${video.videoWidth}x${video.videoHeight}, Duration: ${video.duration}`);
          }}
          onPlaying={() => console.log("[VideoArea Remote] onplaying")}
          onPause={() => console.log("[VideoArea Remote] onpause")}
          onEnded={() => console.log("[VideoArea Remote] onended")}
          onStalled={() => console.warn("[VideoArea Remote] onstalled (media data not arriving)")}
          onSuspend={() => console.warn("[VideoArea Remote] onsuspend (media loading suspended)")}
          onError={(e) => {
            const videoEl = e.target as HTMLVideoElement;
            console.error("[VideoArea Remote] video element error:", videoEl.error);
          }}
        />
        {/* Conditional placeholder rendering */}
        {((!remoteStream && isChatting) || (!remoteStream && !isChatting)) && videoPlaceholder(isChatting ? "Waiting for partner's video..." : "Connecting to partner...", "user")}
      </div>

      {/* Local Video (Your Video) */}
      <div className={cn(
        "overflow-hidden shadow-md bg-black", 
        "absolute top-3 right-3 w-24 aspect-[4/3] z-20 border-2 border-white rounded-md", 
        "sm:w-28",
        "md:order-first md:relative md:static md:w-full md:aspect-video md:top-auto md:right-auto md:z-auto md:border-0 md:rounded-lg"
      )}>
        {localStream ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted // Local preview is usually muted
            className="h-full w-full object-cover"
            onLoadedMetadata={(e) => {
              const video = e.target as HTMLVideoElement;
              console.log(`[VideoArea Local] onloadedmetadata. Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
            }}
            onPlaying={() => console.log("[VideoArea Local] onplaying")}
            onError={(e) => {
              const videoEl = e.target as HTMLVideoElement;
               console.error("[VideoArea Local] video element error:", videoEl.error);
            }}
          />
        ) : (
          videoPlaceholder("Your Video", "user")
        )}
      </div>
    </div>
  );
}

    
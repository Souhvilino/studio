
"use client";

import React, { useEffect, useRef } from 'react';
import { User, VideoOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoAreaProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isChatting: boolean; // This prop is no longer strictly necessary for placeholder logic if we simplify
}

export function VideoArea({ localStream, remoteStream }: VideoAreaProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log("[VideoArea Local] Setting local stream on video element. ID:", localStream?.id, "Tracks active:", localStream?.active);
      localStream.getTracks().forEach(track => {
        console.log(`[VideoArea Local] Local Track: kind=${track.kind}, id=${track.id.substring(0,5)}, label=${track.label.substring(0,10)}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(error => console.warn("[VideoArea Local] localVideoRef.play() promise rejected:", error));
    } else {
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      console.log("[VideoArea Local] Local stream is null or video ref is not current, clearing srcObject.");
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log("[VideoArea Remote] Setting remote stream on video element. ID:", remoteStream.id, "Tracks active:", remoteStream.active);
      const videoTracks = remoteStream.getVideoTracks();
      const audioTracks = remoteStream.getAudioTracks();
      console.log(`[VideoArea Remote] Stream has ${videoTracks.length} video tracks and ${audioTracks.length} audio tracks.`);

      videoTracks.forEach(track => {
        console.log(`[VideoArea Remote Video Track Details] ID: ${track.id.substring(0,5)}, Kind: ${track.kind}, Label: ${track.label.substring(0,10)}, Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`);
      });
      audioTracks.forEach(track => {
        console.log(`[VideoArea Remote Audio Track Details] ID: ${track.id.substring(0,5)}, Kind: ${track.kind}, Label: ${track.label.substring(0,10)}, Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`);
      });

      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play()
        .then(() => console.log("[VideoArea Remote] remoteVideoRef.play() successful."))
        .catch(error => console.warn("[VideoArea Remote] remoteVideoRef.play() promise rejected:", error));
    } else {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      console.log("[VideoArea Remote] Remote stream is null or video ref is not current, clearing srcObject.");
    }
  }, [remoteStream]);

  const videoPlaceholder = (text: string, iconType: 'videoOff' | 'user' = 'videoOff') => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      {iconType === 'videoOff' ? <VideoOff size={48} className="mb-2" /> : <User size={48} className="mb-2" />}
      <p className="text-sm">{text}</p>
    </div>
  );

  return (
    <div className={cn(
      "relative w-full bg-black", // Added bg-black to main container for consistent backdrop
      "aspect-video md:grid md:grid-cols-2 md:gap-1 md:aspect-auto" // md:gap-1 for a small space
    )}>
      {/* Remote Video (Partner's Video) - Takes up main space */}
      <div className="w-full h-full bg-black overflow-hidden md:rounded-lg md:shadow-lg">
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay
          className="h-full w-full object-contain md:object-cover" // Use object-contain for mobile aspect, object-cover for desktop
          onLoadedMetadata={(e) => {
            const video = e.target as HTMLVideoElement;
            console.log(`[VideoArea Remote] onloadedmetadata. Video dimensions: ${video.videoWidth}x${video.videoHeight}, Duration: ${video.duration}`);
          }}
          onLoadedData={() => console.log("[VideoArea Remote] onloadeddata")}
          onCanPlay={() => console.log("[VideoArea Remote] oncanplay")}
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
        {!remoteStream && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {videoPlaceholder("Waiting for partner's video...", "user")}
          </div>
        )}
      </div>

      {/* Local Video (Your Video) - PiP on mobile, side on desktop */}
      <div className={cn(
        "overflow-hidden shadow-md bg-black border-2 border-white rounded-md", 
        // Mobile PiP styles (default)
        "absolute top-3 right-3 w-24 h-auto aspect-[4/3] z-20", 
        // Tablet PiP styles
        "sm:w-32",
        // Desktop side-by-side styles
        "md:order-first md:relative md:static md:w-full md:h-auto md:aspect-video md:top-auto md:right-auto md:z-auto md:border-0 md:rounded-lg"
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

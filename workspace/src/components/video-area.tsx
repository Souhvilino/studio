
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
      console.log("[VideoArea Local] Setting local stream on video element. ID:", localStream?.id);
      localStream.getTracks().forEach(track => {
        console.log(`[VideoArea Local Stream Track] ID: ${track.id}, Kind: ${track.kind}, Label: ${track.label}, Enabled: ${track.enabled}, Muted: ${track.muted}, ReadyState: ${track.readyState}`);
      });
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(error => console.warn("[VideoArea Local] Autoplay prevented:", error));
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log("[VideoArea Remote] Setting remote stream on video element. ID:", remoteStream.id);
      remoteStream.getTracks().forEach(track => {
        console.log(`[VideoArea Remote Stream Prop] Track: id=${track.id}, kind=${track.kind}, label=${track.label}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(error => console.warn("[VideoArea Remote] Autoplay prevented:", error));
    } else if (remoteVideoRef.current) {
      console.log("[VideoArea Remote] Remote stream is null, clearing srcObject.");
      remoteVideoRef.current.srcObject = null;
    }
  }, [remoteStream]);

  const videoPlaceholder = (text: string, iconType: 'videoOff' | 'user' = 'videoOff') => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      {iconType === 'videoOff' ? <VideoOff size={48} className="mb-2" /> : <User size={48} className="mb-2" />}
      <p className="text-sm">{text}</p>
    </div>
  );

  return (
    // Main container: Enforce aspect-video on mobile, let grid define on desktop.
    <div className="relative w-full aspect-video md:grid md:grid-cols-2 md:gap-4 md:aspect-auto">
      
      {/* Remote Video (Partner's Video) - Should be main view on mobile, right grid cell on desktop */}
      <div className="w-full h-full bg-black overflow-hidden md:rounded-lg md:shadow-lg md:aspect-video">
        {(isChatting && remoteStream) ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
            onLoadedMetadata={() => console.log(`[VideoArea Remote] onloadedmetadata. Video dimensions: ${remoteVideoRef.current?.videoWidth}x${remoteVideoRef.current?.videoHeight}`)}
            onPlaying={() => console.log("[VideoArea Remote] onplaying")}
            onError={(e) => console.error("[VideoArea Remote] onerror:", e.target instanceof HTMLVideoElement ? e.target.error : e)}
          />
        ) : (
          videoPlaceholder(isChatting ? "Connecting to partner..." : "Partner's Video", "user")
        )}
      </div>

      {/* Local Video (Your Video - PiP on mobile, left grid cell on desktop) */}
      <div className={cn(
        "overflow-hidden bg-black", 
        // Mobile PiP styles (default)
        "absolute top-3 right-3 w-24 aspect-[4/3] z-20 border-2 border-white rounded-md",
        "sm:w-28", 
        // Desktop: normal flow in grid (order-first makes it appear on the left in LTR grid)
        "md:order-first md:relative md:static md:w-full md:aspect-video md:top-auto md:right-auto md:z-auto md:border-0 md:rounded-lg md:shadow-lg" // Enforce aspect-video for desktop too
      )}>
        {localStream ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
            onLoadedMetadata={() => console.log(`[VideoArea Local] onloadedmetadata. Video dimensions: ${localVideoRef.current?.videoWidth}x${localVideoRef.current?.videoHeight}`)}
            onPlaying={() => console.log("[VideoArea Local] onplaying")}
            onError={(e) => console.error("[VideoArea Local] onerror:", e.target instanceof HTMLVideoElement ? e.target.error : e)}
          />
        ) : (
          videoPlaceholder("Your Video", "user")
        )}
      </div>
    </div>
  );
}

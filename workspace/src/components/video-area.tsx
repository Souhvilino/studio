
"use client";

import React, { useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(error => console.warn("[VideoArea Local] Autoplay prevented:", error));
      console.log("[VideoArea Local] Setting local stream on video element. ID:", localStream?.id, "Tracks:", localStream?.getTracks().map(t => ({ id: t.id, kind: t.kind, label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(error => console.warn("[VideoArea Remote] Autoplay prevented:", error));
      console.log("[VideoArea Remote] Setting remote stream on video element. ID:", remoteStream?.id, "Tracks:", remoteStream?.getTracks().map(t => ({ id: t.id, kind: t.kind, label: t.label, enabled: t.enabled, muted: t.muted, readyState: t.readyState })));
      if (remoteStream.getTracks().length > 0) {
        remoteStream.getTracks().forEach(track => {
          console.log(`[VideoArea Remote] Remote track from prop: id=${track.id}, kind=${track.kind}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        });
      }
    } else if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null; 
      console.log("[VideoArea Remote] Remote stream is null, clearing srcObject.");
    }
  }, [remoteStream]);

  const videoPlaceholder = (text: string, iconType: 'videoOff' | 'user' = 'videoOff') => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      {iconType === 'videoOff' ? <VideoOff size={48} className="mb-2" /> : <User size={48} className="mb-2" />}
      <p className="text-sm">{text}</p>
    </div>
  );

  return (
    <div className="relative w-full md:grid md:grid-cols-2 md:gap-4">
      
      {/* Local Video: PiP on mobile, grid item on desktop */}
      <div className={cn(
        // Mobile PiP styles (default)
        "absolute top-3 right-3 w-24 aspect-[4/3] z-20 border-2 border-white rounded-md overflow-hidden bg-black shadow-md",
        "sm:w-28", // Slightly larger PiP on sm screens
        // Desktop: normal flow in grid
        "md:relative md:static md:w-full md:h-auto md:aspect-video md:top-auto md:right-auto md:z-auto md:border-0 md:rounded-lg md:shadow-none"
      )}>
        {localStream ? (
          <video 
            ref={localVideoRef} 
            autoPlay 
            playsInline 
            muted 
            className="h-full w-full object-cover" // object-cover is key for aspect ratio handling
            onLoadedMetadata={() => console.log(`[VideoArea Local] onloadedmetadata. Video dimensions: ${localVideoRef.current?.videoWidth}x${localVideoRef.current?.videoHeight}`)}
            onPlaying={() => console.log("[VideoArea Local] onplaying")}
            onError={(e) => console.error("[VideoArea Local] onerror:", e)}
          />
        ) : (
          videoPlaceholder("Your Video", "user")
        )}
      </div>

      {/* Remote Video Card: Main view on mobile, second grid cell on desktop (right) */}
      <Card className="w-full aspect-video overflow-hidden shadow-md bg-black md:z-0"> 
        <CardContent className="p-0 h-full w-full">
          {isChatting && remoteStream ? (
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline 
              className="h-full w-full object-cover" 
              onLoadedMetadata={() => console.log(`[VideoArea Remote] onloadedmetadata. Video dimensions: ${remoteVideoRef.current?.videoWidth}x${remoteVideoRef.current?.videoHeight}`)}
              onPlaying={() => console.log("[VideoArea Remote] onplaying")}
              onError={(e) => console.error("[VideoArea Remote] onerror:", e)}
            />
          ) : isChatting && !remoteStream ? (
            videoPlaceholder("Connecting to partner...", "videoOff")
          ) : (
            videoPlaceholder("Partner's Video", "user")
          )}
        </CardContent>
      </Card>

    </div>
  );
}

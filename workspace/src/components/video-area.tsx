
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
      console.log("[VideoArea Local] Setting local stream on video element. Stream ID:", localStream?.id);
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(error => console.warn("[VideoArea Remote] Autoplay prevented:", error));
      console.log("[VideoArea Remote] Setting remote stream on video element. Stream ID:", remoteStream?.id);
      if (remoteStream.getTracks().length > 0) {
        remoteStream.getTracks().forEach(track => {
          console.log(`[VideoArea Remote] Remote track: kind=${track.kind}, id=${track.id}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
        });
      }
    } else if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null; // Clear srcObject if remoteStream is null
    }
  }, [remoteStream]);

  const videoPlaceholder = (text: string) => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      <VideoOff size={48} className="mb-2" />
      <p className="text-sm">{text}</p>
    </div>
  );
  
  const userIconPlaceholder = (text: string) => (
     <div className="flex h-full w-full flex-col items-center justify-center bg-muted text-muted-foreground rounded-md">
      <User size={48} className="mb-2" />
      <p className="text-sm">{text}</p>
    </div>   
  );

  return (
    // Parent container: relative for mobile PiP, becomes grid on desktop
    <div className="relative w-full md:grid md:grid-cols-2 md:gap-4">
      
      {/* Local Video Card: PiP on mobile (top-right), first grid cell on desktop (left) */}
      <Card className={cn(
        "overflow-hidden shadow-md bg-black", // bg-black to avoid placeholder flash if video takes time
        "md:aspect-video md:relative md:top-auto md:right-auto md:z-auto md:border-0 md:rounded-lg", // Desktop: normal flow in grid
        "absolute top-3 right-3 w-24 h-[72px] z-20 border-2 border-white rounded-md", // Mobile: PiP styles (w-24 (96px) -> 4:3 height is 72px (h-18))
        "sm:w-28 sm:h-[84px]" // Slightly larger PiP on sm screens
      )}>
        <CardContent className="p-0 h-full">
          {localStream ? (
            <video 
              ref={localVideoRef} 
              autoPlay 
              playsInline 
              muted 
              className="h-full w-full object-cover"
              onLoadedMetadata={() => console.log(`[VideoArea Local] onloadedmetadata. Video dimensions: ${localVideoRef.current?.videoWidth}x${localVideoRef.current?.videoHeight}`)}
              onPlaying={() => console.log("[VideoArea Local] onplaying")}
              onError={(e) => console.error("[VideoArea Local] onerror:", e)}
            />
          ) : (
            userIconPlaceholder("Your Video")
          )}
        </CardContent>
      </Card>

      {/* Remote Video Card: Main view on mobile, second grid cell on desktop (right) */}
      <Card className="w-full aspect-video overflow-hidden shadow-md bg-black md:z-0"> {/* bg-black to avoid placeholder flash */}
        <CardContent className="p-0 h-full">
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
            videoPlaceholder("Connecting to partner...")
          ) : (
            userIconPlaceholder("Partner's Video")
          )}
        </CardContent>
      </Card>

    </div>
  );
}

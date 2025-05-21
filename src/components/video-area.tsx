"use client";

import React, { useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { User, VideoOff } from 'lucide-react';

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
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-secondary/50 rounded-lg shadow-inner">
      <Card className="aspect-video overflow-hidden shadow-md">
        <CardContent className="p-0 h-full">
          {localStream ? (
            <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          ) : (
            userIconPlaceholder("Your Video")
          )}
        </CardContent>
      </Card>
      <Card className="aspect-video overflow-hidden shadow-md">
        <CardContent className="p-0 h-full">
          {isChatting && remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
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

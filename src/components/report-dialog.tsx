
"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from '@/hooks/use-toast';
import { Flag, Camera, Loader2 } from 'lucide-react';
import type { ReportData } from '@/types';
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
import { app } from '@/lib/firebase'; // Firebase app instance
import html2canvas from 'html2canvas';
import { getIpLocation, type GetIpLocationOutput } from '@/ai/flows/get-ip-location-flow';

const storage = getStorage(app);

interface ReportDialogProps {
  reportedUserId: string | null;
  reportingUserId: string | null;
  currentRoomId: string | null;
  chatAreaScreenshotId: string; // ID of the element to screenshot
  onSubmitReport: (reportData: Omit<ReportData, 'id' | 'timestamp' | 'timestampDate'>) => Promise<void>;
  disabled?: boolean;
}

export function ReportDialog({ reportedUserId, reportingUserId, currentRoomId, chatAreaScreenshotId, onSubmitReport, disabled }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleScreenshotAndUpload = async (): Promise<string | null> => {
    const elementToCapture = document.getElementById(chatAreaScreenshotId);
    if (!elementToCapture) {
      console.error("Screenshot target element not found:", chatAreaScreenshotId);
      toast({ title: "Screenshot Error", description: "Could not find chat area to screenshot.", variant: "destructive" });
      return null;
    }

    try {
      const canvas = await html2canvas(elementToCapture, { useCORS: true, allowTaint: true, scale: 0.75 });
      const imageDataUrl = canvas.toDataURL('image/png');
      
      if (!reportingUserId || !currentRoomId) {
        console.error("Missing user or room ID for screenshot path");
        return null;
      }
      const timestamp = Date.now();
      const storageRef = ref(storage, `report-screenshots/${reportingUserId}/${currentRoomId}-${timestamp}.png`);
      
      await uploadString(storageRef, imageDataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (error) {
      console.error("Screenshot or upload failed:", error);
      toast({ title: "Screenshot Failed", description: "Could not capture or upload screenshot.", variant: "destructive" });
      return null;
    }
  };

  const fetchReporterLocation = async (): Promise<GetIpLocationOutput | undefined> => {
    try {
      const locationData = await getIpLocation({});
      return locationData;
    } catch (error) {
      console.error("Failed to fetch reporter location:", error);
      // Optionally toast, or just proceed without it
      return undefined;
    }
  };

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ title: "Error", description: "Please provide a reason for the report.", variant: "destructive" });
      return;
    }
    if (!reportedUserId || !reportingUserId) {
      toast({ title: "Error", description: "Cannot submit report, user information missing.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    let screenshotUrl: string | null = null;
    let reporterLocationData: GetIpLocationOutput | undefined = undefined;

    try {
      screenshotUrl = await handleScreenshotAndUpload();
      reporterLocationData = await fetchReporterLocation();

      const reportPayload: Omit<ReportData, 'id' | 'timestamp' | 'timestampDate'> = {
        reportedUserId,
        reportingUserId,
        reason,
        roomId: currentRoomId,
      };
      if (screenshotUrl) {
        reportPayload.screenshotUrl = screenshotUrl;
      }
      if (reporterLocationData) {
        reportPayload.reporterLocationData = reporterLocationData;
      }

      await onSubmitReport(reportPayload);
      toast({ title: "Report Submitted", description: "Thank you for your report. We will review it shortly." });
      setReason("");
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to submit report:", error);
      toast({ title: "Error", description: "Failed to submit report. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled || isSubmitting}>
          <Flag className="mr-2 h-4 w-4" /> Report User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card">
        <DialogHeader>
          <DialogTitle>Report User</DialogTitle>
          <DialogDescription>
            Provide a reason for reporting this user. A screenshot of the current chat view will be taken.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="reason" className="text-right">
              Reason
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="col-span-3"
              placeholder="Describe the issue..."
              disabled={isSubmitting}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSubmitting}>Cancel</Button>
          </DialogClose>
          <Button type="submit" onClick={handleSubmit} variant="destructive" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
            {isSubmitting ? "Submitting..." : "Submit Report &amp; Screenshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/hooks/use-toast';
import { Flag } from 'lucide-react';
import type { ReportData } from '@/types';

interface ReportDialogProps {
  reportedUserId: string | null;
  reportingUserId: string | null;
  currentRoomId: string | null;
  onSubmitReport: (reportData: ReportData) => Promise<void>;
  disabled?: boolean;
}

export function ReportDialog({ reportedUserId, reportingUserId, currentRoomId, onSubmitReport, disabled }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast({ title: "Error", description: "Please provide a reason for the report.", variant: "destructive" });
      return;
    }
    if (!reportedUserId || !reportingUserId) {
      toast({ title: "Error", description: "Cannot submit report, user information missing.", variant: "destructive" });
      return;
    }

    try {
      await onSubmitReport({
        reportedUserId,
        reportingUserId,
        reason,
        roomId: currentRoomId,
      });
      toast({ title: "Report Submitted", description: "Thank you for your report. We will review it shortly." });
      setReason("");
      setIsOpen(false);
    } catch (error) {
      console.error("Failed to submit report:", error);
      toast({ title: "Error", description: "Failed to submit report. Please try again.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled}>
          <Flag className="mr-2 h-4 w-4" /> Report User
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card">
        <DialogHeader>
          <DialogTitle>Report User</DialogTitle>
          <DialogDescription>
            Please provide a reason for reporting this user. Your report will be reviewed by our team.
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
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button type="submit" onClick={handleSubmit} variant="destructive">Submit Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

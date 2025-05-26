
"use client";

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, FileText, Ban, ShieldAlert, ImageOff } from 'lucide-react';
import * as FirestoreService from '@/lib/firestore-service';
import type { ReportData } from '@/types';
import { format } from 'date-fns';

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        setError(null);
        const fetchedReports = await FirestoreService.getReports();
        setReports(fetchedReports);
      } catch (err) {
        console.error("Error fetching reports:", err);
        setError(err instanceof Error ? err.message : "An unknown error occurred while fetching reports.");
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, []);

  const handleBanUser = (userId: string, type: 'permanent' | 'temporary') => {
    // Placeholder for ban logic
    console.log(`Attempting to ${type} ban user: ${userId}`);
    alert(`Placeholder: ${type} ban user ${userId.substring(0,8)}...`);
    // TODO: Implement actual ban logic (e.g., update Firestore, notify user, etc.)
  };

  return (
    <div className="container mx-auto p-4 md:p-8 bg-background min-h-screen">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center">
          <ShieldAlert className="mr-3 h-8 w-8" />
          Admin - Submitted Reports
        </h1>
        <p className="text-muted-foreground">Review user-submitted reports for moderation.</p>
      </header>
      <Card className="shadow-xl border-border rounded-lg">
        <CardHeader>
          <CardTitle className="text-xl">All Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="ml-4 text-lg text-muted-foreground">Loading reports...</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-destructive bg-destructive/10 p-6 rounded-md">
              <AlertTriangle className="h-10 w-10 mb-3" />
              <p className="text-lg font-semibold">Error Loading Reports</p>
              <p className="text-sm text-center">{error}</p>
            </div>
          )}
          {!loading && !error && reports.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FileText size={48} className="mx-auto mb-4" />
              <p className="text-xl">No reports found.</p>
              <p>It seems no users have submitted any reports yet.</p>
            </div>
          )}
          {!loading && !error && reports.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="mt-4">A list of user-submitted reports. Newest reports are shown first.</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Date / Time</TableHead>
                    <TableHead className="text-sm">Screenshot</TableHead>
                    <TableHead className="text-sm">Reason</TableHead>
                    <TableHead className="text-sm">Reported User</TableHead>
                    <TableHead className="text-sm">Reporting User</TableHead>
                    <TableHead className="text-sm">Reporter Location</TableHead>
                    <TableHead className="text-sm">Room ID</TableHead>
                    <TableHead className="text-sm text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium text-xs whitespace-nowrap">
                        {report.timestampDate ? format(report.timestampDate, 'MMM d, yyyy, h:mm a') : 'N/A'}
                      </TableCell>
                      <TableCell>
                        {report.screenshotUrl ? (
                          <a href={report.screenshotUrl} target="_blank" rel="noopener noreferrer" className="block w-24 h-16 relative">
                            <Image 
                              src={report.screenshotUrl} 
                              alt="Report screenshot" 
                              layout="fill" 
                              objectFit="contain"
                              className="rounded"
                            />
                          </a>
                        ) : (
                          <div className="w-24 h-16 flex items-center justify-center bg-muted rounded text-muted-foreground">
                            <ImageOff size={24} />
                          </div>
                        )}
                      </TableCell>
                       <TableCell className="text-sm whitespace-pre-wrap break-words max-w-xs">{report.reason}</TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="text-xs p-1 px-2 truncate max-w-[100px] block font-mono">
                          {report.reportedUserId}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs p-1 px-2 truncate max-w-[100px] block font-mono">
                          {report.reportingUserId}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {report.reporterLocationData?.country && report.reporterLocationData?.city ? 
                         `${report.reporterLocationData.city}, ${report.reporterLocationData.country}` : 
                         (report.reporterLocationData?.country || <span className="text-muted-foreground italic">N/A</span>)}
                      </TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-[100px]">
                        {report.roomId || <span className="text-muted-foreground italic">N/A</span>}
                      </TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="border-yellow-500 text-yellow-600 hover:bg-yellow-500/10"
                          onClick={() => handleBanUser(report.reportedUserId, 'temporary')}
                        >
                          Temp Ban
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => handleBanUser(report.reportedUserId, 'permanent')}
                        >
                          <Ban className="mr-1.5 h-3.5 w-3.5" /> Perm Ban
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

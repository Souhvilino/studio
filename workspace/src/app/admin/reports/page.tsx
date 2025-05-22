
"use client";

import React, { useEffect, useState } from 'react';
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
import { Loader2, AlertTriangle } from 'lucide-react';
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

  return (
    <div className="container mx-auto p-4 md:p-8">
      <Card className="shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-primary">Submitted Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-3 text-lg">Loading reports...</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center py-10 text-destructive">
              <AlertTriangle className="h-8 w-8 mb-2" />
              <p className="text-lg font-semibold">Error loading reports</p>
              <p className="text-sm">{error}</p>
            </div>
          )}
          {!loading && !error && reports.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <p className="text-lg">No reports found.</p>
            </div>
          )}
          {!loading && !error && reports.length > 0 && (
            <Table>
              <TableCaption>A list of user-submitted reports.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Date / Time</TableHead>
                  <TableHead>Reported User ID</TableHead>
                  <TableHead>Reporting User ID</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Room ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">
                      {report.timestampDate ? format(report.timestampDate, 'PPpp') : 'N/A'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive" className="truncate max-w-[150px] block">
                        {report.reportedUserId}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="truncate max-w-[150px] block">
                        {report.reportingUserId}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-pre-wrap break-words max-w-xs">{report.reason}</TableCell>
                    <TableCell>{report.roomId || <span className="text-muted-foreground">N/A</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

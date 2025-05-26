
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Chatter Anon - Information',
  description: 'Rules, Policies, and Information for Chatter Anon.',
};

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-amber-50 text-gray-800 flex flex-col items-center p-4 md:p-8">
      <header className="w-full max-w-4xl mb-8">
        <div className="flex justify-between items-center py-4">
          <h1 className="text-3xl font-bold text-blue-600">Chatter Anon</h1>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Chat
            </Link>
          </Button>
        </div>
      </header>
      <main className="w-full max-w-4xl">
        <Card className="shadow-xl bg-card text-card-foreground">
          {children}
        </Card>
      </main>
      <footer className="w-full max-w-4xl mt-12 py-4 text-center text-xs text-muted-foreground border-t border-gray-300">
        &copy; {new Date().getFullYear()} ChatterAnon.com - All Rights Reserved
      </footer>
    </div>
  );
}

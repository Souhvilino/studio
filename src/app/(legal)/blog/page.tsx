
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function BlogPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Chatter Anon Blog</CardTitle>
         <p className="text-sm text-muted-foreground">
          Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </CardHeader>
      <CardContent>
        <p>Welcome to our blog! We&apos;ll be posting updates, tips, and news here soon.</p>
        <p className="mt-4">Stay tuned!</p>
      </CardContent>
    </>
  );
}

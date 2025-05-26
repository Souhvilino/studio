
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function RulesPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Anon Chatter Rules & Policies</CardTitle>
        <p className="text-sm text-muted-foreground">
          Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </CardHeader>
      <CardContent className="space-y-6 prose max-w-none">
        <div>
          <h2 className="font-semibold text-lg">1. Age Requirement</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Strictly 18+ only - no exceptions.</li>
            <li>Users must report anyone suspected to be underage.</li>
            <li>We use AI and device fingerprinting to enforce this.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-lg">2. Prohibited Content</h2>
          <h3 className="font-medium mt-2">❌ Never Allowed:</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nudity/sexual content (including partial).</li>
            <li>Hate speech, racism, or discrimination.</li>
            <li>Weapons or violent imagery.</li>
            <li>Illegal activities/drug promotion.</li>
            <li>Obscene language or harassment.</li>
          </ul>
          <h3 className="font-medium mt-4">🌎 Cultural Note:</h3>
          <p>What&apos;s acceptable in one country may offend elsewhere - keep it respectful.</p>
        </div>

        <div>
          <h2 className="font-semibold text-lg">3. Chat Behavior</h2>
          <h3 className="font-medium mt-2">🚫 No Dating Solicitations</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Gender symbols (&quot;M/F&quot;) or dating requests will get you banned.</li>
          </ul>
          <h3 className="font-medium mt-4">🎭 Virtual Webcams:</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Allowed, but impersonation isn&apos;t.</li>
            <li>You&apos;ll see a warning if someone uses one.</li>
          </ul>
          <h3 className="font-medium mt-4">📢 No Spam/Ads</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>No commercial links, repetitive messages, or camera signs.</li>
            <li>Face must be visible in video chats.</li>
          </ul>
          <h3 className="font-medium mt-4">🤖 No Bots/Scripts</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Unauthorized automation = permanent ban + legal action.</li>
          </ul>
        </div>
        
        <p className="text-sm text-muted-foreground">
            Contact: your-email@anonchatter.com
        </p>
      </CardContent>
    </>
  );
}

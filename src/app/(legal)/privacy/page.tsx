
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function PrivacyPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Privacy Policy</CardTitle>
         <p className="text-sm text-muted-foreground">
          Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </CardHeader>
      <CardContent className="space-y-6 prose max-w-none">
        <div>
          <h2 className="font-semibold text-lg">🔒 We Store:</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Temporary screenshots during active chats for moderation purposes (deleted after a short period).</li>
            <li>Ban enforcement data (such as hashed device identifiers or IP information, deleted if a ban is successfully appealed and overturned).</li>
            <li>We do not store chat logs or video recordings beyond temporary data needed for active moderation.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold text-lg">📊 Advertising:</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Google Ads may use cookies to serve ads based on a user&apos;s prior visits to this website or other websites.</li>
            <li>Users may opt out of personalized advertising by visiting Ads Settings. Alternatively, you can opt out of a third-party vendor&apos;s use of cookies for personalized advertising by visiting www.aboutads.info.</li>
          </ul>
        </div>
         <p className="text-sm text-muted-foreground">
            Contact: your-email@anonchatter.com
        </p>
      </CardContent>
    </>
  );
}

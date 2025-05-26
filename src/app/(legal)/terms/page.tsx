
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function TermsPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Terms of Service</CardTitle>
         <p className="text-sm text-muted-foreground">
          Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </CardHeader>
      <CardContent className="space-y-6 prose max-w-none">
        <div>
          <h2 className="font-semibold text-lg">💸 No Refunds:</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>All payments (if any made for premium features, etc.) are final.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold text-lg">⚖️ Our Liability:</h2>
          <p>We are not responsible for:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Damages from using the service.</li>
            <li>Third-party conduct.</li>
            <li>Unauthorized data access.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold text-lg">🔄 Changes to Policies:</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>We may update rules and terms anytime - check back periodically. Your continued use of the service after changes constitutes acceptance.</li>
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">
            Contact: your-email@anonchatter.com
        </p>
      </CardContent>
    </>
  );
}

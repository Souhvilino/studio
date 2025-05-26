
import { CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export default function FaqPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Frequently Asked Questions (FAQ)</CardTitle>
         <p className="text-sm text-muted-foreground">
          Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger className="font-semibold">How do you moderate chats?</AccordionTrigger>
            <AccordionContent>
              We use a combination of AI scanning for prohibited content 24/7 and human reviewers. User reports also trigger immediate review and action if a violation is found.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger className="font-semibold">Can I use multiple devices?</AccordionTrigger>
            <AccordionContent>
              Yes, you can use Chatter Anon on multiple devices. However, suspicious activity or attempts to circumvent bans across multiple devices may lead to restrictions.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger className="font-semibold">How do I report someone?</AccordionTrigger>
            <AccordionContent>
              During a chat, click the 🚩 (flag) icon. This will open a dialog for you to provide a reason for the report. Our moderation team reviews all submitted reports.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <AccordionTrigger className="font-semibold">Are chats truly anonymous?</AccordionTrigger>
            <AccordionContent>
              We strive for anonymity. We don&apos;t require personal information to chat. While we do log certain data for moderation and ban enforcement (like IP addresses), we don&apos;t store chat content long-term. We advise users not to share personal information.
            </AccordionContent>
          </AccordionItem>
           <AccordionItem value="item-5">
            <AccordionTrigger className="font-semibold">What happens if I get banned?</AccordionTrigger>
            <AccordionContent>
              All bans for serious violations are permanent. We do not offer paid unbans. We track devices, IPs, and behavior patterns to enforce bans. Attempting to circumvent a ban can lead to escalated enforcement actions.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
         <p className="text-sm text-muted-foreground pt-4">
            Contact: your-email@anonchatter.com
        </p>
      </CardContent>
    </>
  );
}

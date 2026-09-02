import { useEffect } from "react";

const LAST_UPDATED = "September 2, 2026";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-inbox-text">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-inbox-muted">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicy() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Kadina Privacy Policy";

    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const previousDescription = meta.getAttribute("content");
    meta.setAttribute("content", "Privacy Policy for Kadina");

    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";

    return () => {
      document.title = previousTitle;
      if (createdMeta && meta?.parentNode) {
        meta.parentNode.removeChild(meta);
      } else if (meta && previousDescription !== null) {
        meta.setAttribute("content", previousDescription);
      }
      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
    };
  }, []);

  return (
    <div className="min-h-full bg-inbox-bg text-inbox-text" dir="ltr">
      <header className="border-b border-inbox-border bg-inbox-panel">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold text-inbox-accent">Kadina</span>
          <span className="text-xs text-inbox-muted">Privacy Policy</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-inbox-text">
            Kadina Privacy Policy
          </h1>
          <p className="text-sm text-inbox-muted">Last Updated: {LAST_UPDATED}</p>
        </div>

        <Section title="Introduction">
          <p>
            Kadina is a clinic communication and inbox platform that helps
            healthcare organizations manage WhatsApp conversations with patients
            and customers. This Privacy Policy describes how information is
            collected, used, and protected when you use Kadina.
          </p>
          <p>
            This policy applies to the Kadina web application and related
            services operated on behalf of a clinic or organization that uses
            Kadina.
          </p>
        </Section>

        <Section title="Information We Collect">
          <p>Depending on how your organization uses Kadina, we may process:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Account information for authorized users (such as name, email
              address, and role within the organization).
            </li>
            <li>
              Contact and conversation data, including phone numbers, message
              content, timestamps, and delivery status.
            </li>
            <li>
              Customer or patient profile fields configured by your organization
              (such as notes, tags, or CRM-related attributes).
            </li>
            <li>
              Media files shared through WhatsApp conversations when your
              organization enables media handling.
            </li>
            <li>
              Technical and operational data, such as IP addresses, browser type,
              device information, and application logs used for security and
              troubleshooting.
            </li>
          </ul>
        </Section>

        <Section title="How We Use Information">
          <p>Information is used to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provide and operate the Kadina inbox and related features.</li>
            <li>
              Authenticate users, enforce access controls, and maintain platform
              security.
            </li>
            <li>
              Route, store, and display WhatsApp messages for authorized clinic
              staff.
            </li>
            <li>
              Support automation, campaigns, analytics, and integrations enabled
              by your organization.
            </li>
            <li>
              Comply with legal obligations and respond to lawful requests.
            </li>
          </ul>
        </Section>

        <Section title="WhatsApp Communications">
          <p>
            Kadina integrates with the WhatsApp Business Platform provided by
            Meta. Messages sent to or from your organization&apos;s WhatsApp
            business number are processed through Kadina so authorized users can
            view and respond to conversations.
          </p>
          <p>
            Your use of WhatsApp is also subject to Meta&apos;s terms and
            policies. Kadina does not control Meta&apos;s independent processing
            of data on WhatsApp&apos;s infrastructure.
          </p>
        </Section>

        <Section title="Data Sharing">
          <p>
            Kadina does not sell personal information. Data may be shared only
            as needed to operate the service, including with:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Infrastructure and hosting providers that process data on behalf of
              the Kadina deployment.
            </li>
            <li>
              Meta / WhatsApp when sending or receiving messages through the
              WhatsApp Business Platform.
            </li>
            <li>
              Third-party integrations explicitly configured by your organization
              (for example, analytics or spreadsheet exports).
            </li>
            <li>
              Authorities when required by applicable law or to protect rights,
              safety, and security.
            </li>
          </ul>
        </Section>

        <Section title="Data Security">
          <p>
            Kadina is designed with administrative access controls, encrypted
            transport (HTTPS), and operational safeguards intended to protect
            stored data. No method of transmission or storage is completely
            secure, and we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="Data Retention">
          <p>
            Information is retained for as long as needed to provide the service,
            meet legal or contractual requirements, and support legitimate
            business operations of the organization using Kadina. Retention
            periods may vary based on your organization&apos;s configuration and
            applicable law.
          </p>
        </Section>

        <Section title="User Rights">
          <p>
            Depending on your location and the policies of the organization that
            operates your Kadina deployment, you may have rights to access,
            correct, delete, or restrict certain processing of your personal
            information.
          </p>
          <p>
            Requests relating to patient or customer data should generally be
            directed to the clinic or organization that uses Kadina, as that
            organization determines how data is collected and used in its
            operations.
          </p>
        </Section>

        <Section title="Contact Information">
          <p>
            If you have questions about this Privacy Policy, please contact the
            administrator of the clinic or organization that operates your Kadina
            deployment.
          </p>
          <p>
            For privacy requests related to data handled through Kadina on behalf
            of that organization, please use the official contact channels
            provided by your clinic or organization.
          </p>
        </Section>
      </main>

      <footer className="border-t border-inbox-border bg-inbox-panel">
        <div className="mx-auto max-w-3xl px-4 py-6 text-center text-xs text-inbox-muted">
          &copy; {new Date().getFullYear()} Kadina. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

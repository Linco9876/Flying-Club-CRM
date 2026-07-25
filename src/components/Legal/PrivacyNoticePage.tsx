import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

const sections = [
  ['What we collect', 'Account and contact details, date of birth, addresses, membership choices and acknowledgements, payment status and payment-provider references, bookings, flight and training records, duty records, safety and maintenance information, portal security events, and documents you choose to upload. Card and bank-account numbers are handled by Stripe and are not stored in the portal.'],
  ['Why we collect it', 'To administer club membership, provide the portal, manage aircraft and instructor bookings, keep operational and safety records, invoice and reconcile payments, communicate with you, secure accounts, meet legal obligations, and investigate incidents or misuse.'],
  ['Who receives it', 'Authorised club officers and instructors receive only the access needed for their role. We use service providers including Supabase for hosted data and authentication, Cloudflare for delivery and security, Stripe for payment methods and payments, Xero for accounting, and email providers for club communications. We do not sell member information.'],
  ['Storage and security', 'The portal uses role-based access, encrypted network connections, staff multi-factor authentication, audit records, security monitoring, encrypted backups and tested recovery procedures. No system is risk-free, so suspected privacy or security incidents should be reported promptly.'],
  ['Retention', 'Membership, financial, training, operational and safety records are retained for the period required for club administration, aviation or accounting obligations, dispute handling and legitimate historical records. Data that is no longer required is deleted, de-identified or access-restricted.'],
  ['Your choices and rights', 'You can review and correct most profile information in the portal. Contact the club to request access, correction, deletion where legally available, or an explanation of a decision. Optional scholarship contributions and marketing-style notifications are not preselected.'],
  ['Questions or complaints', 'Contact the Bendigo Flying Club committee using the details below. We will acknowledge privacy complaints, verify identity where needed, investigate fairly, and explain the outcome and any available review path.'],
] as const;

export const PrivacyNoticePage: React.FC = () => (
  <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-900 sm:py-12">
    <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-2xl sm:p-10">
      <a href="/join" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to membership
      </a>
      <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Bendigo Flying Club</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Portal privacy notice</h1>
      <p className="mt-2 text-sm text-slate-500">Version 2026-07-23 · applies to the membership application and members portal</p>
      <p className="mt-6 text-base leading-7 text-slate-700">
        This notice explains how Bendigo Flying Club handles personal information in its membership and flight-management portal. It should be read with the club’s governing documents and any aviation or safety notices relevant to a particular activity.
      </p>
      <div className="mt-8 space-y-7">
        {sections.map(([title, content]) => {
          const headingId = `privacy-${title.toLowerCase().replaceAll(' ', '-')}`;
          return (
            <section key={title} aria-labelledby={headingId}>
              <h2 id={headingId} className="text-lg font-bold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-700">{content}</p>
            </section>
          );
        })}
      </div>
      <address className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm not-italic leading-7 text-slate-800">
        <strong className="block text-slate-950">Privacy contact</strong>
        Bendigo Flying Club, Victa Road, Bendigo Airport, Victoria, Australia<br />
        <a className="font-semibold text-blue-800 underline" href="mailto:bfc@bendigoflyingclub.com.au">bfc@bendigoflyingclub.com.au</a>
        <span aria-hidden="true"> · </span>
        <a className="font-semibold text-blue-800 underline" href="tel:+61354438395">(03) 5443 8395</a>
      </address>
      <div className="mt-8 rounded-2xl bg-slate-100 p-4 text-sm leading-6 text-slate-700">
        If this notice changes materially, the portal will display the new version and request a fresh acknowledgement where appropriate.
      </div>
    </article>
  </main>
);

export default PrivacyNoticePage;

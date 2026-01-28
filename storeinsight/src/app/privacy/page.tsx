/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export default function PrivacyPolicyPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <div className="ios-card ios-animate-up space-y-6 p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <span className="ios-badge text-[10px]">Policy</span>
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">Privacy Policy</h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">Last updated: 2025-12-15.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/terms" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
                Terms of service
              </Link>
              <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                Directory
              </Link>
            </div>
          </div>

          <div className="space-y-6 text-sm text-[color:var(--text-secondary)]">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">1. Scope</h2>
              <p className="mt-2">
                This policy covers the STORE Internal Platform dashboard, including temporary investor links generated for
                specific properties. Links expire after 24 hours and may be revoked at any time.
              </p>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">2. Data we process</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Property performance metrics, operational KPIs, and historical summaries you upload.</li>
                <li>Security and access metadata such as share-link usage counts and timestamps.</li>
                <li>Technical signals used to protect the service, including rate limiting and error logs.</li>
              </ul>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">3. How we use data</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Render dashboards scoped to the property and investor relationship.</li>
                <li>Protect access to temporary links and investigate suspected misuse.</li>
                <li>Improve data validation and operational workflows.</li>
              </ul>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">4. Sharing and retention</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>Dashboard access is provided only to recipients with valid, unexpired links.</li>
                <li>We store data in our database and Firebase to provide the service.</li>
                <li>Access links expire in 24 hours; audit logs may be retained longer for security.</li>
              </ul>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">5. Security</h2>
              <p className="mt-2">
                We use reasonable administrative, technical, and physical safeguards designed to protect the data
                processed in the dashboard.
              </p>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">6. Your responsibilities</h2>
              <p className="mt-2">
                Do not share access links outside of authorized recipients. If you believe a link was shared improperly,
                notify us so we can revoke access.
              </p>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">7. Changes</h2>
              <p className="mt-2">
                We may update this policy from time to time. The most recent version will always apply.
              </p>
            </div>

            <div className="border-t border-[color:var(--border-soft)] pt-4">
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">8. Contact</h2>
              <p className="mt-2">Questions about this policy? contact lauren@STOREstorage.com</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

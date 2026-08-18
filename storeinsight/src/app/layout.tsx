/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { Metadata, Viewport } from 'next';
import type { JSX } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PreferencesProvider } from '@/components/PreferencesProvider';
import { Analytics } from "@vercel/analytics/next"

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'STORE Internal Platform',
    template: '%s | Report Builder',
  },
  description: 'STORE Internal Platform for operational reporting, analytics, and workflow automation across the portfolio.',
  icons: {
    icon: [
      { url: '/favicon_trans.png', rel: 'icon', sizes: '32x32', type: 'image/png' },
      { url: '/favicon_trans.png', rel: 'shortcut icon', type: 'image/png' },
    ],
    apple: [{ url: '/favicon_trans.png', rel: 'apple-touch-icon' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

// Runs before first paint so dark-mode users never see a light flash on hard navigation.
// Must stay in sync with ThemeProvider's STORAGE_KEY ('storeinsight-theme').
const themeInitScript = `(function(){try{var s=window.localStorage.getItem('storeinsight-theme');var t=s==='dark'||s==='light'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(t);}catch(err){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): JSX.Element {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          'min-h-screen text-[var(--foreground)] antialiased',
        ].join(' ')}
      >
        <ThemeProvider>
          <PreferencesProvider>
            {children}
            <div id="portal-root" />
            <Analytics/>
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

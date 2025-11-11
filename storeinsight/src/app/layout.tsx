import type { Metadata } from 'next';
import type { JSX } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PreferencesProvider } from '@/components/PreferencesProvider';

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
  description: 'Upload Extra Space data, normalize, and export Proforma (.xlsx) and Owner Report (.pdf).',
  icons: { icon: '/favicon.png' },
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): JSX.Element {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          'min-h-screen text-[var(--foreground)] antialiased transition-colors duration-500',
        ].join(' ')}
      >
        <ThemeProvider>
          <PreferencesProvider>
            {children}
            <div id="portal-root" />
          </PreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

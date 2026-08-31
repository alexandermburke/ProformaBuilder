/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Authorization for scheduled endpoints.
 *
 * These routes read shared mailboxes and write bills into QuickBooks companies, and
 * middleware.ts exempts /api/cron/ from session auth, so this function is the only thing
 * standing in front of them.
 *
 * It deliberately does NOT trust the user-agent. Every one of these routes used to accept
 * any request whose user-agent began with "vercel-cron", which is a header a caller sets
 * for free:
 *
 *     curl -A "vercel-cron/1.0" https://<host>/api/cron/faciliq-invoice-intake
 *
 * That was survivable while QuickBooks pointed at a sandbox. Against a real company file it
 * means anyone who learns the URL can post payables into the general ledger.
 *
 * A shared secret is required instead, in either of two forms:
 *   - `Authorization: Bearer <CRON_SECRET>`, which Vercel attaches to scheduled invocations
 *     by itself once CRON_SECRET is set in the project's environment variables; or
 *   - `x-cron-secret: <CRON_SECRET>`, for running a job by hand.
 *
 * Fails closed when CRON_SECRET is unset. A missing secret is a misconfiguration, and the
 * safe reading of "I cannot tell who is calling" is no.
 */

import type { NextRequest } from 'next/server';

export type CronAuthResult =
  | { ok: true; via: 'bearer' | 'header' }
  | { ok: false; reason: string };

const timingSafeEqual = (a: string, b: string): boolean => {
  // Compared without an early exit on length, so the check does not leak the secret's size.
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
};

export function authorizeCronRequest(request: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: false, reason: 'CRON_SECRET is not set on this deployment.' };
  }

  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    if (timingSafeEqual(bearer.slice('Bearer '.length).trim(), secret)) {
      return { ok: true, via: 'bearer' };
    }
    return { ok: false, reason: 'The Authorization bearer token did not match CRON_SECRET.' };
  }

  const header = request.headers.get('x-cron-secret');
  if (header != null) {
    if (timingSafeEqual(header.trim(), secret)) return { ok: true, via: 'header' };
    return { ok: false, reason: 'The x-cron-secret header did not match CRON_SECRET.' };
  }

  return { ok: false, reason: 'No cron credential was presented.' };
}

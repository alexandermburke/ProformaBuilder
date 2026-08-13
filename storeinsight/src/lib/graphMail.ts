/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Microsoft Graph mailbox reads shared by the automated email intakes.
 *
 * `ingestMsrEmails` and `ingestInvoiceEmails` each predate this file and still carry
 * their own copy of the message fetch. New intakes read through here so a third copy
 * of the paging and attachment logic does not appear; those two are left alone rather
 * than refactored, because both run in production on a schedule.
 *
 * Requires the Graph application permission Mail.Read on the target mailbox.
 */

import { getGraphAccessToken } from './graph';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Graph caps $top at 999 for messages; 100 keeps each page small and predictable. */
const PAGE_SIZE = 100;

export type GraphMailMessage = {
  id?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  hasAttachments?: boolean;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
};

export type MailboxBodyContentType = 'text' | 'html';

/**
 * Resolves which mailbox to read. Kept explicit rather than defaulted, so a misconfigured
 * environment fails loudly instead of quietly polling the wrong inbox.
 */
export function resolveMailboxUserId(params: {
  explicit?: string;
  envKeys: readonly string[];
  label: string;
}): string {
  const fromEnv = params.envKeys.map((key) => process.env[key]).find((value) => Boolean(value?.trim()));
  const mailbox = params.explicit?.trim() || fromEnv?.trim();
  if (!mailbox) {
    throw new Error(
      `Missing ${params.label} mailbox user id (set ${params.envKeys.join(' or ')}).`,
    );
  }
  return mailbox;
}

const graphFetch = async (url: string, accessToken: string, extraHeaders?: HeadersInit): Promise<Response> =>
  fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
  });

const failed = async (res: Response, what: string): Promise<never> => {
  const text = await res.text().catch(() => '');
  throw new Error(`${what} failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
};

/**
 * Newest-first messages from a mailbox, following `@odata.nextLink` so a backlog larger
 * than one page is not silently dropped.
 */
export async function fetchMailboxMessages(params: {
  mailbox: string;
  accessToken: string;
  maxMessages?: number;
  select?: readonly string[];
  bodyContentType?: MailboxBodyContentType;
}): Promise<GraphMailMessage[]> {
  const {
    mailbox,
    accessToken,
    maxMessages = 100,
    select = ['id', 'receivedDateTime', 'subject', 'from', 'hasAttachments'],
    bodyContentType,
  } = params;

  const limit = Math.max(1, maxMessages);
  const query = new URLSearchParams({
    $top: String(Math.min(limit, PAGE_SIZE)),
    $select: select.join(','),
    $orderby: 'receivedDateTime desc',
  });

  const collected: GraphMailMessage[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages?${query}`;

  while (nextUrl && collected.length < limit) {
    const res: Response = await graphFetch(
      nextUrl,
      accessToken,
      bodyContentType ? { Prefer: `outlook.body-content-type="${bodyContentType}"` } : undefined,
    );
    if (!res.ok) return failed(res, 'Graph messages fetch');

    const json = (await res.json()) as { value?: GraphMailMessage[]; '@odata.nextLink'?: string };
    if (Array.isArray(json.value)) collected.push(...json.value);
    nextUrl = json['@odata.nextLink'] ?? null;
  }

  return collected.slice(0, limit);
}

/**
 * One message by id. Returns null on 404 so an operator retrying a message that has since
 * been deleted or moved out of the mailbox gets a clear "gone", not a 500.
 */
export async function fetchMailboxMessage(params: {
  mailbox: string;
  messageId: string;
  accessToken: string;
  select?: readonly string[];
}): Promise<GraphMailMessage | null> {
  const {
    mailbox,
    messageId,
    accessToken,
    select = ['id', 'receivedDateTime', 'subject', 'from', 'hasAttachments'],
  } = params;

  const query = new URLSearchParams({ $select: select.join(',') });
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}?${query}`;

  const res = await graphFetch(url, accessToken);
  if (res.status === 404) return null;
  if (!res.ok) return failed(res, 'Graph message fetch');

  return (await res.json()) as GraphMailMessage;
}

export type GraphFileAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
};

type GraphAttachmentListItem = {
  '@odata.type'?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
};

const FILE_ATTACHMENT_TYPE = '#microsoft.graph.fileAttachment';

/**
 * File attachments only. `$select` keeps `contentBytes` out of the listing response, so a
 * large attachment is not pulled into memory just to learn its name -- the bytes are
 * fetched deliberately by `downloadFileAttachment`.
 *
 * Item attachments (a forwarded email) and reference attachments (a OneDrive link) are
 * dropped here: neither carries a CSV this workflow can read. Graph reports the concrete
 * type in `@odata.type`; an entry missing that field is kept and left to the caller's
 * filename/size checks rather than being silently discarded.
 */
export async function listFileAttachments(params: {
  mailbox: string;
  messageId: string;
  accessToken: string;
}): Promise<GraphFileAttachment[]> {
  const { mailbox, messageId, accessToken } = params;
  const query = new URLSearchParams({ $select: 'id,name,contentType,size,isInline' });
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}/attachments?${query}`;

  const res = await graphFetch(url, accessToken);
  if (!res.ok) return failed(res, 'Graph attachment list');

  const json = (await res.json()) as { value?: GraphAttachmentListItem[] };
  const items = Array.isArray(json.value) ? json.value : [];

  return items
    .filter((item) => item['@odata.type'] === undefined || item['@odata.type'] === FILE_ATTACHMENT_TYPE)
    .filter((item): item is GraphAttachmentListItem & { id: string } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name ?? '',
      contentType: item.contentType ?? '',
      size: typeof item.size === 'number' ? item.size : 0,
      isInline: item.isInline === true,
    }));
}

/**
 * Raw attachment bytes via `/$value`, which avoids the base64 round trip that reading
 * `contentBytes` would require.
 */
export async function downloadFileAttachment(params: {
  mailbox: string;
  messageId: string;
  attachmentId: string;
  accessToken: string;
}): Promise<Buffer> {
  const { mailbox, messageId, attachmentId, accessToken } = params;
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
    messageId,
  )}/attachments/${encodeURIComponent(attachmentId)}/$value`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  });
  if (!res.ok) return failed(res, 'Graph attachment download');

  return Buffer.from(await res.arrayBuffer());
}

export { getGraphAccessToken };

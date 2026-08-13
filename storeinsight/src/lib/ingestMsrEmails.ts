import admin from "firebase-admin";
import { firestore } from "@/server/firebaseAdmin";
import { mstDateString } from "./mstDate";
import { getGraphAccessToken } from "./graph";

export type MsrEmailRecord = {
  messageId: string;
  receivedAt: string;
  receivedDateMst?: string;
  from: string;
  subject: string;
  viewerUrl: string;
  processed: boolean;
};

type GraphMessage = {
  id: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { contentType?: string; content?: string };
};

const viewerRegex =
  /https:\/\/reportviewer\.tenantinc\.com\/shared-reports\/owners\/[^\s"'<>]+\/folders\/[^\s"'<>]+/i;
const shortViewerRegex = /https:\/\/renter\.link\/[^\s"'<>]+/i;
const trackingRegex = /https:\/\/track\.pstmrk\.it\/[^\s"'<>]+/i;
const safeLinksRegex = /https:\/\/[^\s"'<>]*safelinks\.protection\.outlook\.com\/[^\s"'<>]+/i;
const hrefRegex = /href=["']([^"']+)["']/gi;
const looseUrlRegex = /https:\/\/[^\s"'<>]+/gi;
const wrappedViewerParamKeys = ["url", "u", "target", "redirect", "redirectUrl"] as const;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const extractDirectViewerUrl = (value: string): string | null => value.match(viewerRegex)?.[0] ?? null;
const extractShortViewerUrl = (value: string): string | null => value.match(shortViewerRegex)?.[0] ?? null;

export const isTenantViewerUrl = (value: string | null | undefined): boolean =>
  Boolean(value && viewerRegex.test(decodeHtmlEntities(value.trim())));

const unwrapViewerUrl = (rawUrl: string, depth = 0): string | null => {
  if (!rawUrl) return null;
  if (depth > 5) return null;

  const normalized = decodeHtmlEntities(rawUrl.trim());
  const directViewerUrl = extractDirectViewerUrl(normalized);
  if (directViewerUrl) return directViewerUrl;
  const shortViewerUrl = extractShortViewerUrl(normalized);
  if (shortViewerUrl) return shortViewerUrl;

  try {
    const decoded = decodeURIComponent(normalized);
    const decodedViewerUrl = extractDirectViewerUrl(decoded);
    if (decodedViewerUrl) return decodedViewerUrl;
    const decodedShortViewerUrl = extractShortViewerUrl(decoded);
    if (decodedShortViewerUrl) return decodedShortViewerUrl;
  } catch {
    // ignore undecodable URLs
  }

  try {
    const parsed = new URL(normalized);
    for (const key of wrappedViewerParamKeys) {
      const wrappedUrl = parsed.searchParams.get(key);
      if (!wrappedUrl) continue;
      const resolvedWrapped = unwrapViewerUrl(wrappedUrl, depth + 1);
      if (resolvedWrapped) {
        return resolvedWrapped;
      }
    }

    if (parsed.hostname.toLowerCase() === "track.pstmrk.it") {
      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      const encodedTarget =
        (pathSegments[0] === "3s" ? pathSegments[1] : pathSegments[0]) ??
        parsed.searchParams.get("url") ??
        parsed.searchParams.get("u");
      if (encodedTarget) {
        const decodedTarget = decodeURIComponent(encodedTarget);
        const targetUrl =
          decodedTarget.startsWith("http://") || decodedTarget.startsWith("https://")
            ? decodedTarget
            : `https://${decodedTarget}`;
        const resolvedTracked = unwrapViewerUrl(targetUrl, depth + 1);
        if (resolvedTracked) {
          return resolvedTracked;
        }
      }
    }
  } catch {
    // ignore invalid wrapper URLs
  }

  return null;
};

export const extractViewerUrlFromHtml = (html: string): string | null => {
  if (!html) return null;

  const normalizedHtml = decodeHtmlEntities(html);
  const directViewerUrl = extractDirectViewerUrl(normalizedHtml);
  if (directViewerUrl) return directViewerUrl;

  const hrefMatches = [...normalizedHtml.matchAll(hrefRegex)];
  for (const match of hrefMatches) {
    const candidate = unwrapViewerUrl(match[1] ?? "");
    if (candidate) return candidate;
  }

  const looseUrlMatches = normalizedHtml.match(looseUrlRegex) ?? [];
  for (const candidateRaw of looseUrlMatches) {
    const candidate = unwrapViewerUrl(candidateRaw);
    if (candidate) return candidate;
  }

  if (trackingRegex.test(normalizedHtml) || safeLinksRegex.test(normalizedHtml)) {
    console.warn("[msr-email] unable to unwrap viewer URL from wrapped email HTML");
  }

  return null;
};

function getMailboxUserId(userId?: string): string {
  const mailboxUser = userId ?? process.env.MSR_MAILBOX_USER_ID ?? process.env.MS_GRAPH_USER_ID;
  if (!mailboxUser) {
    throw new Error("Missing mailbox user id (set MSR_MAILBOX_USER_ID or MS_GRAPH_USER_ID).");
  }
  return mailboxUser;
}

async function fetchMsrMessages(params: {
  userId?: string;
  maxMessages?: number;
  accessToken: string;
}): Promise<GraphMessage[]> {
  const { userId, maxMessages = 50, accessToken } = params;
  const mailboxUser = getMailboxUserId(userId);

  const query = new URLSearchParams({
    $top: Math.min(Math.max(maxMessages, 1), 200).toString(),
    $select: "id,receivedDateTime,subject,from,body",
    $orderby: "receivedDateTime desc",
  });

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUser)}/messages?${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="html"',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph messages fetch failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { value?: GraphMessage[] };
  return Array.isArray(json.value) ? json.value : [];
}

export async function fetchMsrMessageHtmlById(params: { messageId: string; userId?: string }): Promise<string | null> {
  const accessToken = await getGraphAccessToken();
  const mailboxUser = getMailboxUserId(params.userId);
  const query = new URLSearchParams({ $select: "body" });
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUser)}/messages/${encodeURIComponent(params.messageId)}?${query}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="html"',
      },
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph message fetch failed (${res.status} ${res.statusText}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { body?: { content?: string } };
  return typeof json.body?.content === "string" ? json.body.content : null;
}

export async function ingestMsrEmails(options: {
  senderEmail: string;
  subjectPhrase: string;
  maxMessages?: number;
  userId?: string;
  allowedSenders?: string[];
}): Promise<Array<Pick<MsrEmailRecord, "messageId" | "receivedAt" | "viewerUrl">>> {
  if (!firestore) {
    throw new Error("Firebase is not initialized (firestore missing). Check environment variables.");
  }

  const accessToken = await getGraphAccessToken();
  const messages = await fetchMsrMessages({ userId: options.userId, maxMessages: options.maxMessages, accessToken });

  const created: Array<Pick<MsrEmailRecord, "messageId" | "receivedAt" | "viewerUrl">> = [];
  const envAllowed = (process.env.MSR_ALLOWED_SENDERS || "")
    .split(",")
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
  const defaultAllowed = ["info@tenantinc.com", "info@storestorage.com"];
  const allowedList =
    (options.allowedSenders && options.allowedSenders.length > 0
      ? options.allowedSenders
      : envAllowed.length > 0
        ? envAllowed
        : defaultAllowed
    )
      .concat(options.senderEmail)
      .map((s) => s?.toLowerCase().trim())
      .filter(Boolean);
  const allowedSenders = new Set(allowedList);
  console.info("[msr-email] allowed senders", { allowedSenders: Array.from(allowedSenders) });
  const subjectPhraseLower = options.subjectPhrase.toLowerCase();

  for (const message of messages) {
    const messageId = message.id;
    if (!messageId) continue;

    const fromAddress = message.from?.emailAddress?.address?.toLowerCase().trim() ?? "";
    const subjectText = message.subject ?? "";
    if (allowedSenders.size > 0 && !allowedSenders.has(fromAddress)) {
      console.info("[msr-email] skipping due to sender mismatch", {
        id: messageId,
        from: fromAddress,
        allowedSenders: Array.from(allowedSenders),
      });
      continue;
    }
    if (subjectPhraseLower && !subjectText.toLowerCase().includes(subjectPhraseLower)) {
      continue;
    }

    const docRef = firestore.collection("msrEmails").doc(messageId);
    const existing = await docRef.get();
    if (existing.exists) {
      continue;
    }

    const html = message.body?.content ?? "";
    const viewerUrl = extractViewerUrlFromHtml(html);
    if (!viewerUrl) {
      console.warn("[msr-email] viewer URL not found", {
        id: messageId,
        subject: message.subject,
        from: fromAddress,
      });
      continue;
    }

    const receivedAt = message.receivedDateTime ?? new Date().toISOString();
    const receivedDateMst = mstDateString(new Date(receivedAt));
    const record: MsrEmailRecord = {
      messageId,
      receivedAt,
      receivedDateMst,
      from: message.from?.emailAddress?.address ?? "",
      subject: message.subject ?? "",
      viewerUrl,
      processed: false,
    };

    try {
      await docRef.set(
        {
          ...record,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: false },
      );
      created.push({ messageId, receivedAt, viewerUrl });
    } catch (err) {
      const code = (err as { code?: number; message?: string })?.code;
      const msg = (err as { message?: string })?.message ?? "";
      if (code === 6 || msg.includes("ALREADY_EXISTS")) {
        continue;
      }
      console.error("[msr-email] failed to store message", { id: messageId }, err);
    }
  }

  return created;
}

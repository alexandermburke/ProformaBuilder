/** Read-only: find out which Graph filter + orderby combinations this mailbox accepts. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { getGraphAccessToken } = await import("../src/lib/graph");
  const token = await getGraphAccessToken();
  const mailbox = process.env.FACILIQ_MAILBOX_USER_ID ?? "billing@storestorage.com";
  const sender = (process.env.FACILIQ_ALLOWED_SENDERS ?? "support@faciliqpro.com").split(",")[0].trim();
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`;

  const attempts: Array<{ name: string; qs: Record<string, string> }> = [
    {
      name: "A. filter=from eq  +  orderby receivedDateTime desc",
      qs: {
        $top: "5",
        $select: "id,receivedDateTime,subject,from",
        $filter: `from/emailAddress/address eq '${sender}'`,
        $orderby: "receivedDateTime desc",
      },
    },
    {
      name: "B. filter=from eq  (no orderby)",
      qs: {
        $top: "5",
        $select: "id,receivedDateTime,subject,from",
        $filter: `from/emailAddress/address eq '${sender}'`,
      },
    },
    {
      name: "C. filter=receivedDateTime ge  +  orderby receivedDateTime desc",
      qs: {
        $top: "5",
        $select: "id,receivedDateTime,subject,from",
        $filter: `receivedDateTime ge 2026-07-01T00:00:00Z`,
        $orderby: "receivedDateTime desc",
      },
    },
    {
      name: "D. filter=from eq AND receivedDateTime ge  +  orderby receivedDateTime desc",
      qs: {
        $top: "5",
        $select: "id,receivedDateTime,subject,from",
        $filter: `from/emailAddress/address eq '${sender}' and receivedDateTime ge 2026-07-01T00:00:00Z`,
        $orderby: "receivedDateTime desc",
      },
    },
  ];

  for (const attempt of attempts) {
    const url = `${base}?${new URLSearchParams(attempt.qs)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const body = (await res.json()) as {
      value?: Array<{ receivedDateTime?: string; subject?: string; from?: { emailAddress?: { address?: string } } }>;
      error?: { code?: string; message?: string };
    };
    console.log(`\n${attempt.name}`);
    console.log(`  HTTP ${res.status}`);
    if (body.error) {
      console.log(`  ERROR ${body.error.code}: ${String(body.error.message).slice(0, 160)}`);
      continue;
    }
    console.log(`  returned ${body.value?.length ?? 0}`);
    for (const m of (body.value ?? []).slice(0, 3)) {
      console.log(`    ${m.receivedDateTime}  ${m.from?.emailAddress?.address}  ${String(m.subject).slice(0, 48)}`);
    }
  }
};

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

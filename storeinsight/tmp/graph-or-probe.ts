import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
const main = async () => {
  const { getGraphAccessToken } = await import("../src/lib/graph");
  const token = await getGraphAccessToken();
  const mailbox = process.env.FACILIQ_MAILBOX_USER_ID!;
  const senders = (process.env.FACILIQ_ALLOWED_SENDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`senders configured: ${senders.length} -> ${senders.join(", ")}`);
  const filter = senders.map((s) => `from/emailAddress/address eq '${s.replace(/'/g, "''")}'`).join(" or ");
  let url: string | null =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?` +
    new URLSearchParams({ $top: "100", $select: "id,receivedDateTime,subject,from", $filter: filter });
  let total = 0, pages = 0;
  while (url && pages < 20) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { value?: unknown[]; "@odata.nextLink"?: string; error?: { code?: string; message?: string } };
    if (body.error) { console.log(`  ERROR ${body.error.code}: ${body.error.message}`); break; }
    total += body.value?.length ?? 0; pages += 1;
    url = body["@odata.nextLink"] ?? null;
  }
  console.log(`multi-sender filter: HTTP ok, ${total} message(s) across ${pages} page(s)`);
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

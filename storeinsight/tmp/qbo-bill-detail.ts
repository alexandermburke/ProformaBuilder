import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
const main = async () => {
  const [property, id] = [process.argv[2] ?? "L001", process.argv[3] ?? "145"];
  const { getQuickBooksClient } = await import("../src/lib/accounting/quickbooks/client");
  const client = await getQuickBooksClient(property as never);
  const rows = await client.query<Record<string, unknown>>("Bill", `SELECT * FROM Bill WHERE Id = '${id}'`);
  console.log(JSON.stringify(rows[0], null, 2));
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

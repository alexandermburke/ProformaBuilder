import { NextResponse } from "next/server";
import { listRunStatuses } from "@/app/api/daily-summary/store";

export async function GET() {
  const data = await listRunStatuses();
  return NextResponse.json(data);
}
